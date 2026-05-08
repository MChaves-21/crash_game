import {
  Injectable, CanActivate, ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import * as jwksClient from 'jwks-rsa';

/**
 * JwtAuthGuard
 *
 * Valida tokens JWT emitidos pelo Keycloak via JWKS (chave pública).
 *
 * Não faz cache de usuário no banco — o token é a fonte de verdade.
 * O playerId é o `sub` do JWT (UUID gerado pelo Keycloak).
 *
 * Configuração no Keycloak:
 *   Realm: crash-game
 *   Client: crash-game-client (public, PKCE S256)
 *   JWKS: http://keycloak:8080/realms/crash-game/protocol/openid-connect/certs
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly jwks: jwksClient.JwksClient;

  constructor(private readonly jwtService: JwtService) {
    this.jwks = jwksClient({
      jwksUri: process.env.KEYCLOAK_JWKS_URI ??
        'http://keycloak:8080/realms/crash-game/protocol/openid-connect/certs',
      cache:            true,
      cacheMaxAge:      600_000,  // 10 minutos
      rateLimit:        true,
      jwksRequestsPerMinute: 10,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);

    if (!token) throw new UnauthorizedException('Token não fornecido');

    try {
      const header  = this.jwtService.decode(token, { complete: true }) as any;
      const key     = await this.jwks.getSigningKey(header?.header?.kid);
      const pubKey  = key.getPublicKey();

      const payload = this.jwtService.verify(token, {
        publicKey:  pubKey,
        algorithms: ['RS256'],
      });

      req['user'] = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
  }

  private extractToken(req: Request): string | null {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    return auth.slice(7);
  }
}
