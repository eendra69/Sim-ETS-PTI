import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CreateBuyReservationDto, CreateSellReservationDto } from './dto/create-reservation.dto';
import { QueryPositionDto } from './dto/query-position.dto';
import { PositionBalanceService } from './position-balance.service';
import { BalanceReservation, PositionSnapshot } from './position.types';
import { Roles } from '../platform/auth.decorators';

@Controller()
export class PositionBalanceController {
  constructor(private readonly positionBalanceService: PositionBalanceService) {}

  @Get('positions')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'SETTLEMENT_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  listPositions(@Query() query: QueryPositionDto): Promise<PositionSnapshot[]> {
    return this.positionBalanceService.listPositions(query.seriesCode, query.compliancePeriod);
  }

  @Get('positions/:participantId')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'SETTLEMENT_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  getPosition(
    @Param('participantId') participantId: string,
    @Query() query: QueryPositionDto,
  ): Promise<PositionSnapshot> {
    return this.positionBalanceService.getPosition(
      participantId,
      query.seriesCode,
      query.compliancePeriod,
    );
  }

  @Post('balance-reservations/sell')
  @Roles('ADMIN', 'MARKET_OPERATOR', 'UAT_OPERATOR')
  reserveSell(@Body() dto: CreateSellReservationDto): Promise<BalanceReservation> {
    return this.positionBalanceService.reserveSell(dto);
  }

  @Post('balance-reservations/buy')
  @Roles('ADMIN', 'MARKET_OPERATOR', 'UAT_OPERATOR')
  reserveBuy(@Body() dto: CreateBuyReservationDto): Promise<BalanceReservation> {
    return this.positionBalanceService.reserveBuy(dto);
  }

  @Delete('balance-reservations/:reservationId')
  @Roles('ADMIN', 'MARKET_OPERATOR', 'UAT_OPERATOR')
  releaseReservation(@Param('reservationId') reservationId: string): Promise<BalanceReservation> {
    return this.positionBalanceService.releaseReservation(reservationId);
  }
}
