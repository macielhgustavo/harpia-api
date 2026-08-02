import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { AllowAuthenticated } from './auth/decorators/allow-authenticated.decorator';

@AllowAuthenticated()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
