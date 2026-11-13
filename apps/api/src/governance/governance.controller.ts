import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { stringify as toYaml } from 'yaml';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Requires, SignedInOnly } from '../identity/access.decorators';
import {
  ContractImportResultDto,
  ImportContractDto,
  AssetQualityDto,
  SaveQualityRuleDto,
  QualityOptionsDto,
  QualityTestResultDto,
  GovernanceMeaningDto,
  LinkGovernanceTermDto,
  AssetColumnsDto,
  AssetUsageDto,
  GovernanceSummaryDto,
  MoveAssetColumnDto,
  UpdateAssetColumnDto,
  AssetGovernanceDto,
  AssignGovernanceRoleDto,
  GovernancePrincipalDto,
  SourceGovernanceDto,
  UpdateAssetGovernanceDto,
} from './governance.dto';
import { GovernanceInsightsService } from './governance-insights.service';
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
  constructor(
    private readonly governance: GovernanceService,
    private readonly insights: GovernanceInsightsService,
  ) {}

  @Get('assets/:id/governance/meaning')
  @Requires('asset.view')
  @ApiOperation({
    summary: 'The glossary terms an asset is about, and suggested ones',
  })
  @ApiOkResponse({ type: GovernanceMeaningDto })
  assetMeaning(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GovernanceMeaningDto> {
    return this.governance.assetMeaning(id);
  }

  @Post('assets/:id/governance/meaning')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({
    summary: 'Link a glossary term to an asset by hand',
    description:
      'Needs asset.govern, or the owner or steward role on the asset or its source.',
  })
  @ApiOkResponse({ type: GovernanceMeaningDto })
  linkTerm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LinkGovernanceTermDto,
  ): Promise<GovernanceMeaningDto> {
    return this.governance.linkTerm(id, body?.termId);
  }

  @Delete('assets/:id/governance/meaning/:termId')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({ summary: 'Remove a term linked by hand' })
  @ApiOkResponse({ type: GovernanceMeaningDto })
  unlinkTerm(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('termId', ParseUUIDPipe) termId: string,
  ): Promise<GovernanceMeaningDto> {
    return this.governance.unlinkTerm(id, termId);
  }

  @Post('assets/:id/governance/meaning/suggestions/:suggestionId/dismiss')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({ summary: 'Dismiss a suggested term for an asset' })
  @ApiOkResponse({ type: GovernanceMeaningDto })
  dismissSuggestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('suggestionId', ParseUUIDPipe) suggestionId: string,
  ): Promise<GovernanceMeaningDto> {
    return this.governance.dismissSuggestion(id, suggestionId);
  }

  @Get('assets/:id/contract')
  @Requires('asset.view')
  @ApiOperation({
    summary: 'The asset as an Open Data Contract Standard (v3.2) contract',
    description:
      'Description, team, columns with business names and classification, quality rules, SLA. YAML by default.',
  })
  @ApiQuery({ name: 'format', required: false, enum: ['yaml', 'json'] })
  async exportContract(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() reply: FastifyReply,
    @Query('format') format?: string,
  ): Promise<void> {
    const kind = (format ?? 'yaml').toLowerCase();
    if (kind !== 'yaml' && kind !== 'json') {
      throw new BadRequestException('format is yaml or json.');
    }
    const { name, contract } = await this.governance.exportContract(id);
    const file = `${name.replace(/[^A-Za-z0-9._-]+/g, '_') || 'contract'}.odcs.${kind}`;
    await reply
      .header(
        'content-type',
        kind === 'yaml'
          ? 'application/yaml; charset=utf-8'
          : 'application/json',
      )
      .header('content-disposition', `attachment; filename="${file}"`)
      .send(
        kind === 'yaml'
          ? toYaml(contract, { lineWidth: 0 })
          : JSON.stringify(contract, null, 2),
      );
  }

  @Put('assets/:id/contract')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({
    summary: 'Apply an ODCS contract (YAML or JSON text) to the asset',
    description:
      'Matches columns by name and people by e-mail or group path; reports what was skipped. Needs asset.govern, or the owner or steward role.',
  })
  @ApiOkResponse({ type: ContractImportResultDto })
  importContract(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ImportContractDto,
  ): Promise<ContractImportResultDto> {
    return this.governance.importContract(id, body?.contract);
  }

  @Get('assets/:id/quality')
  @Requires('asset.view')
  @ApiOperation({
    summary: "An asset's quality rules, their latest results and its score",
  })
  @ApiOkResponse({ type: AssetQualityDto })
  assetQuality(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AssetQualityDto> {
    return this.governance.assetQuality(id);
  }

  @Post('assets/:id/quality/rules')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({
    summary: 'Add a quality rule to an asset (and evaluate it at once)',
    description:
      'Needs asset.govern, or the owner or steward role on the asset or its source.',
  })
  @ApiOkResponse({ type: AssetQualityDto })
  createQualityRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SaveQualityRuleDto,
  ): Promise<AssetQualityDto> {
    return this.governance.createQualityRule(id, body);
  }

  @Put('quality-rules/:ruleId')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({ summary: 'Change a quality rule (and evaluate it at once)' })
  @ApiOkResponse({ type: AssetQualityDto })
  updateQualityRule(
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() body: SaveQualityRuleDto,
  ): Promise<AssetQualityDto> {
    return this.governance.updateQualityRule(ruleId, body);
  }

  @Delete('quality-rules/:ruleId')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({
    summary: 'Delete a quality rule; its open finding is resolved',
  })
  @ApiOkResponse({ type: AssetQualityDto })
  removeQualityRule(
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
  ): Promise<AssetQualityDto> {
    return this.governance.removeQualityRule(ruleId);
  }

  @Get('assets/:id/quality/options')
  @Requires('asset.view')
  @ApiOperation({
    summary:
      'What a quality rule on this asset can use: columns, SQL name, open findings by kind',
  })
  @ApiOkResponse({ type: QualityOptionsDto })
  qualityOptions(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QualityOptionsDto> {
    return this.governance.qualityOptions(id);
  }

  @Post('assets/:id/quality/test')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({
    summary: 'Measure a quality rule now without saving it',
    description:
      'Nothing is stored and no finding changes. Whole-table rules run their query and wait up to a minute. Needs the right to govern the asset.',
  })
  @ApiOkResponse({ type: QualityTestResultDto })
  testQualityRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SaveQualityRuleDto,
  ): Promise<QualityTestResultDto> {
    return this.governance.testQualityRule(id, body);
  }

  @Post('assets/:id/quality/run')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({ summary: "Evaluate an asset's quality rules now" })
  @ApiOkResponse({ type: AssetQualityDto })
  runQuality(@Param('id', ParseUUIDPipe) id: string): Promise<AssetQualityDto> {
    return this.governance.runQuality(id);
  }

  @Get('assets/:id/columns')
  @Requires('asset.view')
  @ApiOperation({
    summary:
      "A table's columns: what stewards said and what open findings classify",
  })
  @ApiOkResponse({ type: AssetColumnsDto })
  assetColumns(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AssetColumnsDto> {
    return this.governance.assetColumns(id);
  }

  @Put('assets/:id/columns/:name')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({
    summary: 'Describe, classify or confirm one column',
    description:
      'Needs asset.govern, or the owner or steward role on the asset or its source.',
  })
  @ApiOkResponse({ type: AssetColumnsDto })
  updateColumn(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('name') name: string,
    @Body() body: UpdateAssetColumnDto,
  ): Promise<AssetColumnsDto> {
    return this.governance.updateColumn(id, name, body ?? {});
  }

  @Post('assets/:id/columns/:name/move')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({
    summary: "Move a removed column's annotations to the column it became",
  })
  @ApiOkResponse({ type: AssetColumnsDto })
  moveColumn(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('name') name: string,
    @Body() body: MoveAssetColumnDto,
  ): Promise<AssetColumnsDto> {
    return this.governance.moveColumn(id, name, body?.to);
  }

  @Delete('assets/:id/columns/:name')
  @Requires('asset.view')
  @SignedInOnly()
  @ApiOperation({ summary: 'Forget what was said about one column' })
  @ApiOkResponse({ type: AssetColumnsDto })
  removeColumn(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('name') name: string,
  ): Promise<AssetColumnsDto> {
    return this.governance.removeColumn(id, name);
  }

  @Get('assets/:id/usage')
  @Requires('activity.view')
  @ApiOperation({
    summary: 'Who read and exported a table, per day, over the last days',
  })
  @ApiQuery({ name: 'days', required: false, description: '1–365, default 30' })
  @ApiOkResponse({ type: AssetUsageDto })
  usage(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('days') days?: string,
  ): Promise<AssetUsageDto> {
    return this.insights.usage(id, Number(days ?? 30));
  }

  @Get('governance/summary')
  @Requires('asset.view')
  @ApiOperation({
    summary:
      'How far the workspace is governed: coverage per source, what to govern first, yours',
  })
  @ApiQuery({ name: 'days', required: false, description: '1–365, default 30' })
  @ApiOkResponse({ type: GovernanceSummaryDto })
  summary(@Query('days') days?: string): Promise<GovernanceSummaryDto> {
    return this.insights.summary(this.governance.person(), Number(days ?? 30));
  }

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
