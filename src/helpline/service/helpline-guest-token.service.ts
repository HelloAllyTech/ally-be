import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';
import { AppConfigService } from 'src/config/config.service';
import { ErrorCode } from 'src/exception/error-code.enum';
import {
  HELPLINE_GUEST,
  HelplineChannel,
} from '../constants/helpline.constants';
import { HelplineGuestIdentity } from '../type/helpline.types';
import { guestTokenInvalid, helplineError } from '../util/helpline-errors';

interface GuestClaims {
  sub?: string;
  aud?: string | string[];
  typ?: string;
  cid?: string;
  tid?: string;
  ch?: string;
}

/**
 * Guest tokens for anonymous talkers (contract §5.2).
 *
 * HS256 with a secret that is NEVER the user access secret:
 * `HELPLINE_GUEST_JWT_SECRET` when set, otherwise
 * HMAC-SHA256(JWT_ACCESS_SECRET, 'helpline-guest-v1'). So `JwtStrategy`
 * (access secret) cannot verify a guest token, and this service (guest
 * secret, `aud: helpline-guest`, `typ: helpline_guest`) cannot verify a user
 * token — each door opens to exactly one kind of key.
 */
@Injectable()
export class HelplineGuestTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: AppConfigService,
  ) {}

  /** The signing secret. Throws when the deployment has neither source. */
  secret(): string {
    const dedicated = this.configService.helplineGuestJwtSecret;
    if (dedicated) return dedicated;
    return this.derive(HELPLINE_GUEST.SECRET_LABEL);
  }

  /**
   * HMAC-SHA256 of the client ip with a server-side salt, for the 24 h block
   * window and abuse checks. Not reversible without the salt, which never
   * leaves the server.
   */
  hashIp(ip: string | null | undefined): string | null {
    if (!ip) return null;
    return createHmac('sha256', this.derive(HELPLINE_GUEST.IP_SALT_LABEL))
      .update(ip)
      .digest('hex');
  }

  async sign(
    identity: HelplineGuestIdentity,
    expiresAt?: Date,
  ): Promise<{ token: string; expiresAt: Date }> {
    const now = Date.now();
    const exp = expiresAt ?? new Date(now + HELPLINE_GUEST.TTL_SECONDS * 1000);
    const expiresIn = Math.max(1, Math.floor((exp.getTime() - now) / 1000));
    const token = await this.jwtService.signAsync(
      {
        typ: HELPLINE_GUEST.TOKEN_TYPE,
        cid: identity.chatId,
        tid: identity.tenantId,
        ch: HelplineChannel.TEXT_WEB,
      },
      {
        secret: this.secret(),
        algorithm: 'HS256',
        audience: HELPLINE_GUEST.AUDIENCE,
        subject: identity.talkerId,
        expiresIn,
      },
    );
    return { token, expiresAt: new Date(now + expiresIn * 1000) };
  }

  /** Verified identity, or HELPLINE_GUEST_TOKEN_INVALID. */
  async verify(
    token: string | null | undefined,
  ): Promise<HelplineGuestIdentity> {
    if (!token) throw guestTokenInvalid();
    let claims: GuestClaims;
    try {
      claims = await this.jwtService.verifyAsync<GuestClaims & object>(token, {
        secret: this.secret(),
        algorithms: ['HS256'],
        audience: HELPLINE_GUEST.AUDIENCE,
      });
    } catch {
      throw guestTokenInvalid();
    }
    if (
      claims.typ !== HELPLINE_GUEST.TOKEN_TYPE ||
      !claims.sub ||
      !claims.cid ||
      !claims.tid
    ) {
      throw guestTokenInvalid();
    }
    return { talkerId: claims.sub, chatId: claims.cid, tenantId: claims.tid };
  }

  /**
   * Routing hint for the socket handshake only: does this token CLAIM to be a
   * guest token? Unverified — the caller then verifies with the matching
   * secret, so a forged `aud` buys nothing.
   */
  looksLikeGuestToken(token: string): boolean {
    const decoded = this.jwtService.decode(token) as GuestClaims | null;
    const aud = decoded?.aud;
    return Array.isArray(aud)
      ? aud.includes(HELPLINE_GUEST.AUDIENCE)
      : aud === HELPLINE_GUEST.AUDIENCE;
  }

  private derive(label: string): string {
    const base =
      this.configService.helplineGuestJwtSecret ||
      this.configService.jwt.accessToken.secret;
    if (!base) {
      throw helplineError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.CONFIGURATION_ERROR,
        'Helpline guest tokens are not configured',
      );
    }
    return createHmac('sha256', base).update(label).digest('hex');
  }
}
