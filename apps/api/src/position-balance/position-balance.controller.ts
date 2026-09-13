import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CreateBuyReservationDto, CreateSellReservationDto } from './dto/create-reservation.dto';
import { QueryPositionDto } from './dto/query-position.dto';
import { PositionBalanceService } from './position-balance.service';
import { BalanceReservation, PositionSnapshot } from './position.types';

@Controller()
export class PositionBalanceController {
  constructor(private readonly positionBalanceService: PositionBalanceService) {}

  @Get('positions')
  listPositions(@Query() query: QueryPositionDto): Promise<PositionSnapshot[]> {
    return this.positionBalanceService.listPositions(query.seriesCode, query.compliancePeriod);
  }

  @Get('positions/:participantId')
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
  reserveSell(@Body() dto: CreateSellReservationDto): Promise<BalanceReservation> {
    return this.positionBalanceService.reserveSell(dto);
  }

  @Post('balance-reservations/buy')
  reserveBuy(@Body() dto: CreateBuyReservationDto): Promise<BalanceReservation> {
    return this.positionBalanceService.reserveBuy(dto);
  }

  @Delete('balance-reservations/:reservationId')
  releaseReservation(@Param('reservationId') reservationId: string): Promise<BalanceReservation> {
    return this.positionBalanceService.releaseReservation(reservationId);
  }
}
