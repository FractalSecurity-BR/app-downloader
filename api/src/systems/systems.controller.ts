import { Controller, Get } from '@nestjs/common';

import { SystemsService } from './systems.service';

@Controller('api')
export class SystemsController {
  constructor(private readonly systems: SystemsService) {}

  @Get('systems')
  list() {
    return { systems: this.systems.listPublic() };
  }

  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
