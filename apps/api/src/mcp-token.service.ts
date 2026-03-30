import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from './prisma.service';
import {
  CreateMcpTokenDto,
  McpTokenCreatedResponseDto,
  McpTokenResponseDto,
  UpdateMcpTokenDto,
} from './dto/mcp-settings.dto';
import { MCP_TOKEN_PREFIX } from './mcp-catalog';
import { resolveApplicationSecretKey } from './secret-key.util';

const TOKEN_PATTERN = new RegExp(
  `^${MCP_TOKEN_PREFIX}_([0-9a-fA-F-]{36})\\.([A-Za-z0-9_-]{32,})$`,
);

type ParsedToken = {
  id: string;
  secret: string;
  raw: string;
};

type GeneratedToken = ParsedToken;

type StoredMcpAccessToken = {
  id: string;
  name: string;
  tokenHash: string;
  tokenPreview: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class McpTokenService {
  private readonly tokenKey = resolveApplicationSecretKey();

  constructor(private readonly prisma: PrismaService) {}

  private get tokenModel(): {
    findMany(args: Record<string, unknown>): Promise<StoredMcpAccessToken[]>;
    findUnique(
      args: Record<string, unknown>,
    ): Promise<StoredMcpAccessToken | null>;
    create(args: Record<string, unknown>): Promise<StoredMcpAccessToken>;
    update(args: Record<string, unknown>): Promise<StoredMcpAccessToken>;
    delete(args: Record<string, unknown>): Promise<StoredMcpAccessToken>;
  } {
    return (this.prisma as any).mcpAccessToken;
  }

  async listTokens(): Promise<McpTokenResponseDto[]> {
    const rows = await this.tokenModel.findMany({
      orderBy: [{ revokedAt: 'asc' }, { updatedAt: 'desc' }],
    });
    return rows.map((row) => this.toResponse(row));
  }

  async createToken(
    dto: CreateMcpTokenDto,
  ): Promise<McpTokenCreatedResponseDto> {
    const generated = this.generateToken();
    const token = await this.tokenModel.create({
      data: {
        id: generated.id,
        name: dto.name.trim(),
        tokenHash: this.hashToken(generated.raw),
        tokenPreview: this.buildPreview(generated),
      },
    });
    return {
      ...this.toResponse(token),
      plainTextToken: generated.raw,
    };
  }

  async updateToken(
    id: string,
    dto: UpdateMcpTokenDto,
  ): Promise<McpTokenResponseDto> {
    const existing = await this.tokenModel.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`MCP token ${id} not found`);
    }

    const token = await this.tokenModel.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.isActive !== undefined
          ? { revokedAt: dto.isActive ? null : new Date() }
          : {}),
      },
    });

    return this.toResponse(token);
  }

  async deleteToken(id: string): Promise<{ deleted: true }> {
    const existing = await this.tokenModel.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`MCP token ${id} not found`);
    }

    await this.tokenModel.delete({ where: { id } });
    return { deleted: true };
  }

  async authorizeBearerToken(
    authHeader?: string,
  ): Promise<StoredMcpAccessToken> {
    const token = this.extractBearerToken(authHeader);
    const parsed = this.parseToken(token);
    const record = await this.tokenModel.findUnique({
      where: { id: parsed.id },
    });

    if (!record || record.revokedAt) {
      throw new UnauthorizedException('Invalid MCP bearer token');
    }

    const actual = Buffer.from(this.hashToken(parsed.raw), 'hex');
    const expected = Buffer.from(record.tokenHash, 'hex');
    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    ) {
      throw new UnauthorizedException('Invalid MCP bearer token');
    }

    await this.tokenModel.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });

    return record;
  }

  private toResponse(token: StoredMcpAccessToken): McpTokenResponseDto {
    return {
      id: token.id,
      name: token.name,
      tokenPreview: token.tokenPreview,
      isActive: token.revokedAt === null,
      lastUsedAt: token.lastUsedAt,
      revokedAt: token.revokedAt,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
    };
  }

  private extractBearerToken(authHeader?: string): string {
    if (!authHeader) {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const [scheme, token] = authHeader.trim().split(/\s+/, 2);
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException(
        'Authorization header must use Bearer token format',
      );
    }

    return token;
  }

  private parseToken(token: string): ParsedToken {
    const match = TOKEN_PATTERN.exec(token.trim());
    if (!match) {
      throw new BadRequestException(
        `Invalid MCP token format. Expected ${MCP_TOKEN_PREFIX}_<uuid>.<secret>`,
      );
    }

    const [, id, secret] = match;
    if (!id || !secret) {
      throw new BadRequestException('Malformed MCP token');
    }

    return {
      id,
      secret,
      raw: token.trim(),
    };
  }

  private generateToken(): GeneratedToken {
    const id = crypto.randomUUID();
    const secret = crypto.randomBytes(32).toString('hex');
    const raw = `${MCP_TOKEN_PREFIX}_${id}.${secret}`;

    return {
      id,
      secret,
      raw,
    };
  }

  private buildPreview(parsed: ParsedToken): string {
    return `${MCP_TOKEN_PREFIX}_${parsed.id.slice(0, 8)}...${parsed.secret.slice(-5)}`;
  }

  private hashToken(rawToken: string): string {
    return crypto
      .createHmac('sha256', this.tokenKey)
      .update(rawToken)
      .digest('hex');
  }
}
