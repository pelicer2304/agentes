import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateSettingsDto } from './update-settings.dto';

describe('UpdateSettingsDto', () => {
  function createDto(partial: Partial<UpdateSettingsDto>): UpdateSettingsDto {
    return plainToInstance(UpdateSettingsDto, partial);
  }

  it('should pass validation with all required fields', async () => {
    const dto = createDto({
      agentName: 'Test Agent',
      initialMessage: 'Hello there!',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass validation with all fields provided', async () => {
    const dto = createDto({
      agentName: 'Test Agent',
      initialMessage: 'Hello there!',
      toneOfVoice: 'Professional',
      services: ['Service A', 'Service B'],
      doNotPromise: ['Rule 1'],
      handoffCriteria: ['Criteria 1'],
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail when agentName is empty', async () => {
    const dto = createDto({
      agentName: '',
      initialMessage: 'Hello',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const agentNameError = errors.find((e) => e.property === 'agentName');
    expect(agentNameError).toBeDefined();
  });

  it('should fail when agentName is missing', async () => {
    const dto = createDto({
      initialMessage: 'Hello',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const agentNameError = errors.find((e) => e.property === 'agentName');
    expect(agentNameError).toBeDefined();
  });

  it('should fail when initialMessage is empty', async () => {
    const dto = createDto({
      agentName: 'Agent',
      initialMessage: '',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const initialMessageError = errors.find(
      (e) => e.property === 'initialMessage',
    );
    expect(initialMessageError).toBeDefined();
  });

  it('should fail when initialMessage is missing', async () => {
    const dto = createDto({
      agentName: 'Agent',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const initialMessageError = errors.find(
      (e) => e.property === 'initialMessage',
    );
    expect(initialMessageError).toBeDefined();
  });

  it('should fail when agentName exceeds 100 characters', async () => {
    const dto = createDto({
      agentName: 'a'.repeat(101),
      initialMessage: 'Hello',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const agentNameError = errors.find((e) => e.property === 'agentName');
    expect(agentNameError).toBeDefined();
  });

  it('should pass when agentName is exactly 100 characters', async () => {
    const dto = createDto({
      agentName: 'a'.repeat(100),
      initialMessage: 'Hello',
    });

    const errors = await validate(dto);
    const agentNameError = errors.find((e) => e.property === 'agentName');
    expect(agentNameError).toBeUndefined();
  });

  it('should fail when initialMessage exceeds 500 characters', async () => {
    const dto = createDto({
      agentName: 'Agent',
      initialMessage: 'a'.repeat(501),
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const initialMessageError = errors.find(
      (e) => e.property === 'initialMessage',
    );
    expect(initialMessageError).toBeDefined();
  });

  it('should pass when initialMessage is exactly 500 characters', async () => {
    const dto = createDto({
      agentName: 'Agent',
      initialMessage: 'a'.repeat(500),
    });

    const errors = await validate(dto);
    const initialMessageError = errors.find(
      (e) => e.property === 'initialMessage',
    );
    expect(initialMessageError).toBeUndefined();
  });

  it('should fail when toneOfVoice exceeds 300 characters', async () => {
    const dto = createDto({
      agentName: 'Agent',
      initialMessage: 'Hello',
      toneOfVoice: 'a'.repeat(301),
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const toneError = errors.find((e) => e.property === 'toneOfVoice');
    expect(toneError).toBeDefined();
  });

  it('should fail when services has more than 20 items', async () => {
    const dto = createDto({
      agentName: 'Agent',
      initialMessage: 'Hello',
      services: Array.from({ length: 21 }, (_, i) => `Service ${i}`),
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const servicesError = errors.find((e) => e.property === 'services');
    expect(servicesError).toBeDefined();
  });

  it('should pass when services has exactly 20 items', async () => {
    const dto = createDto({
      agentName: 'Agent',
      initialMessage: 'Hello',
      services: Array.from({ length: 20 }, (_, i) => `Service ${i}`),
    });

    const errors = await validate(dto);
    const servicesError = errors.find((e) => e.property === 'services');
    expect(servicesError).toBeUndefined();
  });

  it('should fail when a service item exceeds 200 characters', async () => {
    const dto = createDto({
      agentName: 'Agent',
      initialMessage: 'Hello',
      services: ['a'.repeat(201)],
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const servicesError = errors.find((e) => e.property === 'services');
    expect(servicesError).toBeDefined();
  });

  it('should fail when doNotPromise has more than 20 items', async () => {
    const dto = createDto({
      agentName: 'Agent',
      initialMessage: 'Hello',
      doNotPromise: Array.from({ length: 21 }, (_, i) => `Rule ${i}`),
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const doNotPromiseError = errors.find(
      (e) => e.property === 'doNotPromise',
    );
    expect(doNotPromiseError).toBeDefined();
  });

  it('should fail when handoffCriteria has more than 10 items', async () => {
    const dto = createDto({
      agentName: 'Agent',
      initialMessage: 'Hello',
      handoffCriteria: Array.from({ length: 11 }, (_, i) => `Criteria ${i}`),
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const handoffError = errors.find(
      (e) => e.property === 'handoffCriteria',
    );
    expect(handoffError).toBeDefined();
  });

  it('should pass when handoffCriteria has exactly 10 items', async () => {
    const dto = createDto({
      agentName: 'Agent',
      initialMessage: 'Hello',
      handoffCriteria: Array.from({ length: 10 }, (_, i) => `Criteria ${i}`),
    });

    const errors = await validate(dto);
    const handoffError = errors.find(
      (e) => e.property === 'handoffCriteria',
    );
    expect(handoffError).toBeUndefined();
  });

  it('should fail when a handoffCriteria item exceeds 200 characters', async () => {
    const dto = createDto({
      agentName: 'Agent',
      initialMessage: 'Hello',
      handoffCriteria: ['a'.repeat(201)],
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const handoffError = errors.find(
      (e) => e.property === 'handoffCriteria',
    );
    expect(handoffError).toBeDefined();
  });
});
