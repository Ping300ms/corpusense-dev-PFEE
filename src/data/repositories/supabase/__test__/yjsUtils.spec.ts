import { describe, it, expect } from 'vitest';
import {
  syncableToUint8,
  merge
} from '@/data/repositories/supabase/yjsUtils';
import { CollectionDetails } from '@/data/models/Collection.ts';

describe('Conversion syncable --> uint --> syncable', () => {
  it('shoud convert CollectionDetails', () => {

  });

  it('shoud convert CollectionContent', () => {

  })

  it('shoud convert Annotation', () => {

  });

  it('shoud convert DataModel', () => {

  })
});

describe('Merge CollectionDetails', () => {
  function getCollectionDetails() {
    return {
      id: '123',
      name: 'My Collection',
      about: 'Some details',
      tags: ['science', 'math'],
      contentSize: 2,
      offline: false,
    } as CollectionDetails;
  }

  it('should apply remote changes', () => {
    // do a copy and test object type conversion and reconversion
    const local = getCollectionDetails();
    const remote = getCollectionDetails();
    // simulate remote changes
    remote.name = 'My new Collection';
    remote.about = remote.about + ' some additional text';
    remote.tags.push('test');
    const merged = merge(local, syncableToUint8(remote));
    const result = merged.local as CollectionDetails;
    console.log(result);
    expect(result.id).toEqual('123');
    expect(result.name).toEqual('My new Collection');
    expect(result.about).toEqual('Some details some additional text');
    expect(result.tags.length).toEqual(remote.tags.length);
    expect(result.tags[2]).toEqual('test');
  });

  it('should apply local changes', () => {
    const remote = getCollectionDetails();
    const local = getCollectionDetails();
    // simulate local changes
    local.tags.push('test');
    local.name = 'My new Collection';
    local.about = local.about + ' some additional text';
    const merged = merge(local, syncableToUint8(remote));
    const result = merged.local as CollectionDetails;
    console.log(result);
    expect(result.id).toEqual(local.id);
    expect(result.name).toEqual('My new Collection');
    expect(result.about).toEqual('Some details some additional text');
    expect(result.tags.length).toEqual(local.tags.length);
    expect(result.tags[2]).toEqual('test');
  });

  it('should apply both local and remote changes', () => {
    const remote = getCollectionDetails();
    const local = getCollectionDetails();

    local.tags.push('test');
    local.name = 'My new Collection';
    local.about = local.about + ' some additional text';

    remote. tags.push('new');
    remote.name = 'My Collection test 1234';
    remote.about = 'Some details some additional text etc';

    const merged = merge(local, syncableToUint8(remote));
    const result = merged.local as CollectionDetails;
    console.log(result);
    expect(result.id).toEqual(local.id);
    expect(result.about).toEqual('Some details some additional text etc');
    expect(result.tags.length).toEqual(4);
  });
});



// TODO test DataModel, Annotation, CollectionContent