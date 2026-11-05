import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ACCESS_POLICY, type AccessPolicy } from './access-policy';
import { Requires } from './access.decorators';
import { ActorContextService } from './actor-context.service';
import type { IamConfig } from './iam-config';
import { IAM_CONFIG } from './identity.tokens';
import { MeResponseDto } from './me.dto';

@ApiTags('Identity')
@Controller('me')
export class MeController {
  constructor(
    private readonly actors: ActorContextService,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
    @Inject(IAM_CONFIG) private readonly iam: IamConfig | null,
  ) {}

  @Get()
  @Requires('workspace.view')
  @ApiOperation({
    summary: 'Who is calling, and what they may do in this workspace',
  })
  @ApiOkResponse({ type: MeResponseDto })
  async me(): Promise<MeResponseDto> {
    const actor = this.actors.current();
    const capabilities = await this.policy.capabilities(actor);
    return {
      actor: {
        id: actor.id,
        displayName: actor.displayName,
        kind: actor.kind,
        via: actor.via,
      },
      iamEnabled: this.iam !== null,
      capabilities: [...capabilities].sort(),
    };
  }
}
