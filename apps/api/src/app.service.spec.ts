import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;

  beforeEach(() => {
    service = new AppService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return health status ok', () => {
    const result = service.getHealth();
    expect(result).toEqual({ status: 'ok' });
  });
});
