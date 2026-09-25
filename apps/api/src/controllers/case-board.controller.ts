import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActorName } from '../actor-name.decorator';
import { CaseBoardService } from '../case-board/case-board.service';
import { CaseBoardReadService } from '../case-board/case-board-read.service';
import {
  ApplyBoardOpsDto,
  ApplyBoardOpsResponseDto,
  BoardNeighboursDto,
  BoardTraceRequestDto,
  BoardTraceResponseDto,
  CaseBoardResponseDto,
  CaseBoardSnapshotDto,
  CaseBoardSnapshotSummaryDto,
} from '../dto/case-board.dto';
import { GraphResponseDto } from '../dto/graph.dto';

/**
 * The case board: one canvas per case (docs/architecture/CASE_BOARD_PRD.md).
 * Reads are lazy — the first GET creates the board and its items — and every
 * write goes through POST .../ops.
 */
@ApiTags('case-board')
@Controller('cases/:id/board')
export class CaseBoardController {
  constructor(
    private readonly board: CaseBoardService,
    private readonly boardRead: CaseBoardReadService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'The case board: items, links, evidence, the live graph layer, stances and thread summaries',
  })
  @ApiResponse({ status: 200, type: CaseBoardResponseDto })
  get(@Param('id') id: string): Promise<CaseBoardResponseDto> {
    return this.boardRead.getBoard(id);
  }

  @Post('ops')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Apply a batch of board ops in one transaction; refused ops are reported per op',
  })
  @ApiResponse({ status: 200, type: ApplyBoardOpsResponseDto })
  applyOps(
    @Param('id') id: string,
    @Body() dto: ApplyBoardOpsDto,
    @ActorName() actor: string | undefined,
  ): Promise<ApplyBoardOpsResponseDto> {
    return this.board.applyOps(id, dto, actor);
  }

  @Post('neighbours')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Live depth-1 neighbourhood of one evidence bubble (drawn as suggested items)',
  })
  @ApiResponse({ status: 200, type: GraphResponseDto })
  neighbours(
    @Param('id') id: string,
    @Body() dto: BoardNeighboursDto,
  ): Promise<GraphResponseDto> {
    return this.board.neighbours(id, dto?.itemId);
  }

  @Post('trace')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Trace assets' connections: upstream, downstream and sideways through lineage, links, duplicates and similarity",
  })
  @ApiResponse({ status: 200, type: BoardTraceResponseDto })
  trace(
    @Param('id') id: string,
    @Body() dto: BoardTraceRequestDto,
  ): Promise<BoardTraceResponseDto> {
    return this.board.trace(id, dto);
  }

    @Get('snapshots')
  @ApiOperation({ summary: 'Board snapshots, newest first' })
  @ApiResponse({ status: 200, type: [CaseBoardSnapshotSummaryDto] })
  listSnapshots(
    @Param('id') id: string,
  ): Promise<CaseBoardSnapshotSummaryDto[]> {
    return this.boardRead.listSnapshots(id);
  }

  @Get('snapshots/:snapshotId')
  @ApiOperation({ summary: 'One board snapshot, exactly as it was captured' })
  @ApiResponse({ status: 200, type: CaseBoardSnapshotDto })
  getSnapshot(
    @Param('id') id: string,
    @Param('snapshotId') snapshotId: string,
  ): Promise<CaseBoardSnapshotDto> {
    return this.boardRead.getSnapshot(id, snapshotId);
  }

  @Post('snapshots')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Capture the board as it is now' })
  @ApiResponse({ status: 201, type: CaseBoardSnapshotSummaryDto })
  takeSnapshot(
    @Param('id') id: string,
    @ActorName() actor: string | undefined,
  ): Promise<CaseBoardSnapshotSummaryDto> {
    return this.boardRead.takeSnapshot(id, 'MANUAL', actor);
  }
}
