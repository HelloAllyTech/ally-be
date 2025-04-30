import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository, MoreThan } from 'typeorm';
import { User } from '../../common/entities/user.entity';
import { UserGroup } from '../../common/entities/user-group.entity';
import { Group } from '../../common/entities/group.entity';
import * as bcrypt from 'bcrypt';
import { RefreshToken } from '../../common/entities/refresh-token.entity';
import { AppConfigService } from '../../config/config.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRole, UserStatus } from '../../common/constants/user.constants';
import { UserCreateDto } from '../dto/user-create.dto';
import { RedisService } from 'src/redis/service/redis.service';
import { GroupPermission } from 'src/common/entities/group-permission.entity';
import { Permission } from '../../common/entities/permission.entity';
import { LoggerService } from '../../logger/logger.service';
import { AuthUtil } from '../util/auth.util';

@Injectable()
export class AuthService {
  private readonly PASSWORD_MIN_LENGTH = 6; // Move to config service if needed
  private readonly logger = LoggerService.getInstance(AuthService.name);
  private readonly OTP_TTL;
  private userRepository: Repository<User>;
  private refreshTokenRepository: Repository<RefreshToken>;
  private userGroupRepository: Repository<UserGroup>;
  private groupRepository: Repository<Group>;
  private groupPermissionRepository: Repository<GroupPermission>;

  constructor(
    private dataSource: DataSource,
    private jwtService: JwtService,
    private configService: AppConfigService,
    private eventEmitter: EventEmitter2,
    private readonly cache: RedisService,
  ) {
    this.userRepository = this.dataSource.getRepository(User);
    this.refreshTokenRepository = this.dataSource.getRepository(RefreshToken);
    this.userGroupRepository = this.dataSource.getRepository(UserGroup);
    this.groupRepository = this.dataSource.getRepository(Group);
    this.groupPermissionRepository =
      this.dataSource.getRepository(GroupPermission);
    this.userRepository = this.dataSource.getRepository(User);
    this.refreshTokenRepository = this.dataSource.getRepository(RefreshToken);
    this.OTP_TTL = +this.configService.otp.ttl;
  }

  // ... existing validateUser and validateUserById methods ...

  async validateRefreshToken(refreshToken: string, userId: number) {
    const token = await this.refreshTokenRepository.findOne({
      where: {
        userId: userId,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!token || !(await bcrypt.compare(refreshToken, token.token))) {
      throw new UnauthorizedException();
    }

    const user = await this.userRepository.findOneOrFail({
      where: { id: userId },
    });
    const { password, ...result } = user;
    return result;
  }

  private async generateTokens(user: User) {
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        expiresIn: this.configService.jwt.accessToken.expiresIn,
        secret: this.configService.jwt.accessToken.secret,
      }),
      this.jwtService.signAsync(payload, {
        expiresIn: this.configService.jwt.refreshToken.expiresIn,
        secret: this.configService.jwt.refreshToken.secret,
      }),
    ]);

    // Calculate expiry date based on config
    const ttlDays = this.configService.jwt.refreshToken.ttlDays;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    // Store the hashed refresh token in DB
    await this.refreshTokenRepository.save({
      token: await bcrypt.hash(refreshToken, 10),
      userId: user.id,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  async refreshTokens(oldRefreshToken: string, userId: number) {
    // Find and validate the old refresh token
    const tokenEntity = await this.refreshTokenRepository.findOne({
      where: {
        userId,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (
      !tokenEntity ||
      !(await bcrypt.compare(oldRefreshToken, tokenEntity.token))
    ) {
      throw new UnauthorizedException();
    }

    // Delete the old refresh token (rotation)
    await this.refreshTokenRepository.remove(tokenEntity);

    // Generate new tokens
    const user = await this.userRepository.findOneOrFail({
      where: { id: userId },
    });
    return this.generateTokens(user);
  }

  async login(username: string, password: string) {
    const user = await this.userRepository.findOne({
      where: { username },
      select: ['id', 'username', 'password', 'role'],
    });

    if (!user) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const tokens = await this.generateTokens(user);

    return {
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      ...tokens,
      tokenType: 'bearer',
    };
  }

  async logout(userId: number) {
    // Delete all refresh tokens for the user
    await this.refreshTokenRepository.delete({ userId });
  }

  async signup(userData: UserCreateDto): Promise<Omit<User, 'password'>> {
    // TODO: Revisit this once we have a phone number in table & cofnirmation on how the flow works with admins
    // Check if user with email already exists
    const existingUser = await this.userRepository.findOne({
      where: { email: userData.email },
    });

    // can cause user enumeration
    if (existingUser) {
      throw new BadRequestException('Email already registered');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(userData.password, 10);

    // Create new user
    const newUser = this.userRepository.create({
      email: userData.email,
      password: hashedPassword,
      name: userData.name,
      role: userData.role || UserRole.CLIENT, // Default role
      status: UserStatus.ACTIVE,
      metadata: {},
      username: userData.email,
      phone: userData.phone,
    });

    // Save user
    const savedUser = await this.userRepository.save(newUser);

    // find group id using role
    const group = await this.groupRepository.findOne({
      where: { name: userData.role || UserRole.CLIENT },
    });

    if (group) {
      // Add user to default group
      await this.userGroupRepository.save({
        userId: savedUser.id,
        groupId: group.id,
      });
    }

    // Emit user created event
    this.eventEmitter.emit('user.created', {
      userId: savedUser.id,
    });

    // Remove password from response
    const { password, ...userWithoutPassword } = savedUser;
    return userWithoutPassword;
  }

  async register(email: string, password: string, username: string) {
    return this.signup({
      email,
      password,
      name: username, // Using username as name, you might want to separate these
    });
  }

  async getUserPermissions(id: number): Promise<string[]> {
    // Get user's groups from cache or DB
    const cachedUserGroups = await this.cache.get(`user:groups:${id}`);
    let userGroups;

    if (cachedUserGroups) {
      userGroups = JSON.parse(cachedUserGroups);
    } else {
      // Fetch user groups from DB
      userGroups = await this.userGroupRepository
        .find({
          select: { groupId: true },
          where: { userId: id },
        })
        .then((rows) => rows.map((row) => row.groupId));

      await this.cache.set(`user:groups:${id}`, JSON.stringify(userGroups));
    }

    if (!userGroups.length) return [];

    // Get permissions for each group from cache or DB
    const permissions = new Set<string>();
    const missingGroupIds = new Set<number>();

    // First check cache for all groups
    for (const groupId of userGroups) {
      const cachedGroupPermissions = await this.cache.get(
        `group:permissions:${groupId}`,
      );
      if (cachedGroupPermissions) {
        const groupPermissions = JSON.parse(cachedGroupPermissions);
        groupPermissions.forEach((p: string) => permissions.add(p));
      } else {
        missingGroupIds.add(groupId);
      }
    }

    // If any permissions are missing from cache, fetch them all at once
    if (missingGroupIds.size > 0) {
      const missingPermissions = await this.groupPermissionRepository
        .createQueryBuilder('gp')
        .leftJoin(Permission, 'p', 'p.id = gp."permissionId"')
        .select('gp.groupId', 'groupId')
        .addSelect('p.name', 'permission')
        .where('gp.groupId IN (:...groupIds)', {
          groupIds: [...missingGroupIds],
        })
        .getRawMany();

      // Group permissions by groupId
      const groupedPermissions = missingPermissions.reduce(
        (acc, curr) => {
          if (!acc[curr.groupId]) {
            acc[curr.groupId] = [];
          }
          acc[curr.groupId].push(curr.permission);
          permissions.add(curr.permission);
          return acc;
        },
        {} as Record<number, string[]>,
      );

      // Cache each group's permissions
      await Promise.all(
        Object.entries(groupedPermissions).map(([groupId, perms]) =>
          this.cache.set(`group:permissions:${groupId}`, JSON.stringify(perms)),
        ),
      );
    }

    return [...permissions];
  }

  async generateOtp(phone: string) {
    const user = await this.userRepository.findOne({
      where: { phone: phone },
    });
    if (!user) {
      this.logger.error(`User not found for phone ${phone}`);
      return true; // to prevent user enumeration
      //throw new BadRequestException('User not found');
    }
    const otp = AuthUtil.generateOtp();
    await this.cache.set(`otp:${phone}`, otp, this.OTP_TTL);

    // send otp to user
    this.eventEmitter.emit('otp.generated', {
      phone,
      otp,
    });
    return true;
  }

  async verifyOtp(phone: string, otp: string) {
    const cachedOtp = await this.cache.get(phone);
    if (cachedOtp !== otp) {
      throw new BadRequestException('Invalid OTP');
    }
    await this.cache.del(phone);

    if (cachedOtp === otp) {
      // generate token
      const user = await this.userRepository.findOne({
        where: { phone: phone },
      });
      if (!user) {
        throw new BadRequestException('User not found');
      }
      return this.generateTokens(user);
    }
  }
}
