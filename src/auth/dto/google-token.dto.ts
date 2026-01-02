import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleIdTokenDto {
  @ApiProperty({
    description: 'Google ID Token',
    example:
      'eyJhhenAiOiIxMDI0MjM0NTY3ODkwLXNhbXBsZS1hcHAuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20iLCJhdWQiOiIxMDI0MjM0NTY3ODkwLXNhbXBsZS1hcHAuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20iLCJzdWIiOiIxMDI0MjM0NTY3ODkwMTIzNDU2Nzg5MCIs',
  })
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}
