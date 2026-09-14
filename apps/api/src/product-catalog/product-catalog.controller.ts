import { Controller, Get, Param, Query } from '@nestjs/common';
import { Roles } from '../platform/auth.decorators';
import {
  AdmissionQueryDto,
  EligibilityQueryDto,
  HoldingQueryDto,
  InstallationQueryDto,
  TraderScopeQueryDto,
  VintageQueryDto,
} from './dto/catalog-query.dto';
import { ProductCatalogService } from './product-catalog.service';

const catalogueReadRoles = [
  'ADMIN',
  'AUDITOR',
  'MARKET_OPERATOR',
  'SETTLEMENT_OPERATOR',
  'TRADER',
  'UAT_OPERATOR',
] as const;

@Controller()
export class ProductCatalogController {
  constructor(private readonly catalogue: ProductCatalogService) {}

  @Get('product-series')
  @Roles(...catalogueReadRoles)
  listSeries() {
    return this.catalogue.listSeries();
  }

  @Get('quota-vintages')
  @Roles(...catalogueReadRoles)
  listVintages(@Query() query: VintageQueryDto) {
    return this.catalogue.listVintages(query.seriesCode, query.targetCompliancePeriod);
  }

  @Get('quota-vintages/:vintageId')
  @Roles(...catalogueReadRoles)
  getVintage(@Param('vintageId') vintageId: string, @Query() query: VintageQueryDto) {
    return this.catalogue.getVintage(vintageId, query.targetCompliancePeriod);
  }

  @Get('product-admissions')
  @Roles(...catalogueReadRoles)
  listAdmissions(@Query() query: AdmissionQueryDto) {
    return this.catalogue.listAdmissions(query.seriesCode, query.vintageYear);
  }

  @Get('vintage-eligibility')
  @Roles(...catalogueReadRoles)
  evaluateEligibility(@Query() query: EligibilityQueryDto) {
    return this.catalogue.evaluateEligibility(
      query.seriesCode,
      query.vintageYear,
      query.targetCompliancePeriod,
    );
  }

  @Get('installations')
  @Roles(...catalogueReadRoles)
  listInstallations(@Query() query: InstallationQueryDto) {
    return this.catalogue.listInstallations(query.participantId);
  }

  @Get('trader-installation-scopes')
  @Roles(...catalogueReadRoles)
  listTraderScopes(@Query() query: TraderScopeQueryDto) {
    return this.catalogue.listTraderScopes(query.traderAccountId, query.participantId);
  }

  @Get('vintage-holdings')
  @Roles(...catalogueReadRoles)
  listHoldings(@Query() query: HoldingQueryDto) {
    return this.catalogue.listHoldings(query);
  }
}

