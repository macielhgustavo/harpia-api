import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from './decorators/public.decorator';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthThrottlerGuard } from './guards/auth-throttler.guard';

interface AuthenticatedUser {
  id: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ register: {} })
  @SkipThrottle({ login: true, forgot: true, reset: true })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ login: {} })
  @SkipThrottle({ register: true, forgot: true, reset: true })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ forgot: {} })
  @SkipThrottle({ login: true, register: true, reset: true })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ reset: {} })
  @SkipThrottle({ login: true, register: true, forgot: true })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('change-password')
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, dto);
  }
}
