import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Requires, SignedInOnly } from '../identity/access.decorators';
import {
  AssetGovernanceDto,
  AssignGovernanceRoleDto,
  GovernancePrincipalDto,
  SourceGovernanceDto,
  UpdateAssetGovernanceDto,
} from './governance.dto';
import { GovernanceService } from './governance.service';

/**
 * Governed data assets (docs/prd/GOV-governed-data-assets.md, G-1).
 *
 * Reads need `asset.view`. Changes declare `asset.view` too, and the service
 * decides (R3): `asset.govern` on the workspace, or the owner or steward
 * role on the asset or its source — a role no workspace grant expresses. The
 * service records those changes in the audit trail itself.
 */
@ApiTags('Governance')
@Controller()
export class GovernanceController {
  constructor(private readonly governance: GovernanceService) {}

  @Get('assets/:id/governance')
  @Requires('asset.view')
  @ApiOperation({
    summary: "An asset's owners, description, lifecycle and checklist",
  })
  @ApiOkResponse({ type: AssetGovernanceDto })
  assetGovernance(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AssetGovernanceDto> {
    return this.governance.assetGovernance(id);
  }

  @Put('assets/:id/governance')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({
    summary: "Change an asset's description, legal basis or lifecycle",
    description:
      'Needs asset.govern, or the owner or steward role on the asset or its source. ACTIVE certifies the asset and needs an owner.',
  })
  @ApiOkResponse({ type: AssetGovernanceDto })
  updateAssetGovernance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAssetGovernanceDto,
  ): Promise<AssetGovernanceDto> {
    return this.governance.updateAssetGovernance(id, body);
  }

  @Post('assets/:id/governance/roles')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({
    summary: 'Make someone owner, steward or custodian of an asset',
    description:
      'A new owner replaces the current one; the old row is kept as history.',
  })
  @ApiOkResponse({ type: AssetGovernanceDto })
  assignAssetRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignGovernanceRoleDto,
  ): Promise<AssetGovernanceDto> {
    return this.governance.assignAssetRole(id, body?.role, body?.principalRef);
  }

  @Delete('assets/:id/governance/roles/:roleId')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({ summary: 'End a role on an asset (kept as history)' })
  @ApiOkResponse({ type: AssetGovernanceDto })
  removeAssetRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<AssetGovernanceDto> {
    return this.governance.removeAssetRole(id, roleId);
  }

  @Get('sources/:id/governance')
  @Requires('asset.view')
  @ApiOperation({
    summary: "A source's owners, stewards and custodians, and its coverage",
  })
  @ApiOkResponse({ type: SourceGovernanceDto })
  sourceGovernance(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SourceGovernanceDto> {
    return this.governance.sourceGovernance(id);
  }

  @Post('sources/:id/governance/roles')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({
    summary: 'Make someone owner, steward or custodian of a source',
    description:
      'Roles on a source apply to its assets that set none of their own.',
  })
  @ApiOkResponse({ type: SourceGovernanceDto })
  assignSourceRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignGovernanceRoleDto,
  ): Promise<SourceGovernanceDto> {
    return this.governance.assignSourceRole(id, body?.role, body?.principalRef);
  }

  @Delete('sources/:id/governance/roles/:roleId')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({ summary: 'End a role on a source (kept as history)' })
  @ApiOkResponse({ type: SourceGovernanceDto })
  removeSourceRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<SourceGovernanceDto> {
    return this.governance.removeSourceRole(id, roleId);
  }

  @Get('governance/principals')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({
    summary:
      'People and groups of the tenant, for the owner and steward pickers',
    description:
      'Needs asset.govern or access.view, or an owner or steward role somewhere in the workspace. At most 20.',
  })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({
    name: 'kinds',
    required: false,
    description: 'Comma-separated: user, group. Default both.',
  })
  @ApiOkResponse({ type: [GovernancePrincipalDto] })
  principals(
    @Query('q') q?: string,
    @Query('kinds') kinds?: string,
  ): Promise<GovernancePrincipalDto[]> {
    const wanted = (kinds ?? 'user,group')
      .split(',')
      .map((kind) => kind.trim())
      .filter(
        (kind): kind is 'user' | 'group' => kind === 'user' || kind === 'group',
      );
    return this.governance.searchPrincipals(
      q,
      wanted.length ? wanted : ['user', 'group'],
    );
  }
}
