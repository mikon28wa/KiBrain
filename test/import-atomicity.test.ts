import { describe, expect, it } from 'vitest';
import { importChatForOwner, registerAndImport } from '../src/api/chatImport';
import { createInMemoryImportManager } from './import-helpers';

const base = {
  email: 'a@example.com',
  consent: true,
  messages: [{ role: 'user', content: 'Hello' }],
  tags: ['tag1'],
};

describe('import atomicity', () => {
  it('register+import leaves no partial state when message persistence fails', async () => {
    const { manager, state, setFailOn } = createInMemoryImportManager();
    setFailOn('createMessages');

    await expect(registerAndImport(manager, { ...base, passwordHash: 'hash' })).rejects.toThrow();

    expect(state.users).toHaveLength(0);
    expect(state.chats).toHaveLength(0);
    expect(state.messages).toHaveLength(0);
    expect(state.tags).toHaveLength(0);
  });

  it('register+import leaves no orphan account when tag persistence fails', async () => {
    const { manager, state, setFailOn } = createInMemoryImportManager();
    setFailOn('createTags');

    await expect(registerAndImport(manager, { ...base, passwordHash: 'hash' })).rejects.toThrow();

    expect(state.users).toHaveLength(0);
    expect(state.chats).toHaveLength(0);
    expect(state.messages).toHaveLength(0);
    expect(state.tags).toHaveLength(0);
  });

  it('a subsequent retry succeeds after a failed register+import', async () => {
    const { manager, state, setFailOn } = createInMemoryImportManager();
    setFailOn('createTags');
    await expect(registerAndImport(manager, { ...base, passwordHash: 'hash' })).rejects.toThrow();
    expect(state.users).toHaveLength(0);

    setFailOn(undefined);
    const result = await registerAndImport(manager, { ...base, passwordHash: 'hash' });

    expect(result.userId).toBeTruthy();
    expect(state.users).toHaveLength(1);
    expect(state.chats).toHaveLength(1);
    expect(state.messages).toHaveLength(1);
    expect(state.tags).toHaveLength(1);
  });

  it('import into an existing account leaves no partial chat when tag persistence fails', async () => {
    const { manager, state, setFailOn } = createInMemoryImportManager();
    setFailOn('createTags');

    await expect(importChatForOwner(manager, 'user-a', base)).rejects.toThrow();

    expect(state.chats).toHaveLength(0);
    expect(state.messages).toHaveLength(0);
    expect(state.tags).toHaveLength(0);
  });

  it('register+import rejects a duplicate email without creating a second account', async () => {
    const { manager, state } = createInMemoryImportManager();

    await registerAndImport(manager, { ...base, passwordHash: 'hash' });
    await expect(
      registerAndImport(manager, { ...base, passwordHash: 'hash2' }),
    ).rejects.toThrow();

    expect(state.users).toHaveLength(1);
    expect(state.chats).toHaveLength(1);
  });
});
