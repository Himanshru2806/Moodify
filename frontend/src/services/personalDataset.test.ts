import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  clearPersonalDataset,
  deletePersonalDatasetContribution,
  listPersonalDatasetContributions,
  savePersonalDatasetContribution,
} from './personalDataset';

describe('browser-local personal dataset storage', () => {
  afterEach(async () => {
    await clearPersonalDataset();
  });

  it('stores photo blobs and user-selected expression labels locally', async () => {
    const image = new Blob(['photo payload'], { type: 'image/jpeg' });
    await savePersonalDatasetContribution({
      id: 'personal-photo-1',
      image,
      expression: 'neutral',
    });

    const records = await listPersonalDatasetContributions();
    expect(records).toHaveLength(1);
    expect(records[0].expression).toBe('neutral');
    expect(records[0].image.size).toBe(image.size);
    expect(records[0].image.type).toBe('image/jpeg');
    expect(records[0].createdAt).toBeTruthy();
  });

  it('supports deleting one contribution and clearing all contributions', async () => {
    await savePersonalDatasetContribution({
      id: 'personal-photo-1',
      image: new Blob(['first']),
      expression: 'sad',
    });
    await savePersonalDatasetContribution({
      id: 'personal-photo-2',
      image: new Blob(['second']),
      expression: 'happy',
    });

    await deletePersonalDatasetContribution('personal-photo-1');
    expect(await listPersonalDatasetContributions()).toHaveLength(1);

    await clearPersonalDataset();
    expect(await listPersonalDatasetContributions()).toHaveLength(0);
  });
});