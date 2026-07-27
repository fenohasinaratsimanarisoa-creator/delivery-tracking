import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RoutingService } from './routing.service';
import {
  DirectionsRequestDto,
  DirectionsResponse,
  MatchRequestDto,
  MatchResponse,
} from './dto/routing.dto';

@Controller('routing')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class RoutingController {
  constructor(private routingService: RoutingService) {}

  @Post('directions')
  async getDirections(@Body() dto: DirectionsRequestDto): Promise<DirectionsResponse> {
    return this.routingService.getDirections(dto);
  }

  @Post('alternatives')
  async getAlternatives(
    @Body() dto: DirectionsRequestDto,
  ): Promise<{ routes: DirectionsResponse[] }> {
    dto.alternatives = true;
    const main = await this.routingService.getDirections(dto);
    const routes: DirectionsResponse[] = [main];
    if (main.alternatives) {
      for (const alt of main.alternatives) {
        routes.push({
          polyline: alt.polyline,
          distance: alt.distance,
          duration: alt.duration,
          steps: alt.steps,
          provider: main.provider,
        });
      }
    }
    return { routes };
  }

  @Post('match')
  async matchToRoad(@Body() dto: MatchRequestDto): Promise<MatchResponse> {
    return this.routingService.matchToRoad(dto);
  }
}
