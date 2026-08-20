import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WorkerType } from '../../enum/user.enum';
import {
  BULK_SET_WORKER_TYPE_MAX,
  BulkSetWorkerTypeDto,
  SetWorkerTypeDto,
} from '../worker-type.dto';

describe('SetWorkerTypeDto', () => {
  const errorsFor = async (workerType: unknown) => {
    const dto = plainToInstance(SetWorkerTypeDto, { workerType });
    return validate(dto);
  };

  it('accepts every declared WorkerType value', async () => {
    for (const value of Object.values(WorkerType)) {
      expect(await errorsFor(value)).toHaveLength(0);
    }
  });

  it('rejects a value outside the enum', async () => {
    expect(await errorsFor('SENIOR_CLINICIAN')).not.toHaveLength(0);
  });

  it('rejects a missing value', async () => {
    expect(await errorsFor(undefined)).not.toHaveLength(0);
  });

  it('rejects a lowercase variant (no leniency — this widens what an admin can set)', async () => {
    expect(await errorsFor('lay')).not.toHaveLength(0);
  });
});

describe('BulkSetWorkerTypeDto', () => {
  const errorsFor = async (body: Record<string, unknown>) => {
    const dto = plainToInstance(BulkSetWorkerTypeDto, body);
    return validate(dto);
  };

  it('accepts a list of user ids with a valid worker type', async () => {
    expect(
      await errorsFor({ userIds: [1, 2, 3], workerType: WorkerType.LAY }),
    ).toHaveLength(0);
  });

  it('rejects an empty id list', async () => {
    expect(
      await errorsFor({ userIds: [], workerType: WorkerType.LAY }),
    ).not.toHaveLength(0);
  });

  it('rejects a non-integer or non-positive id', async () => {
    expect(
      await errorsFor({ userIds: [1, -2], workerType: WorkerType.LAY }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor({ userIds: [1, 2.5], workerType: WorkerType.LAY }),
    ).not.toHaveLength(0);
  });

  it('rejects an invalid worker type', async () => {
    expect(
      await errorsFor({ userIds: [1, 2], workerType: 'UNKNOWN' }),
    ).not.toHaveLength(0);
  });

  it('rejects a batch larger than the cap', async () => {
    const userIds = Array.from(
      { length: BULK_SET_WORKER_TYPE_MAX + 1 },
      (_, i) => i + 1,
    );
    expect(
      await errorsFor({ userIds, workerType: WorkerType.LAY }),
    ).not.toHaveLength(0);
  });
});
