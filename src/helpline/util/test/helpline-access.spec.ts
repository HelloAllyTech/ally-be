import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { HelplineAccess } from '../../constants/helpline.constants';
import { resolveChatAccess } from '../helpline-access';

describe('resolveChatAccess', () => {
  const chat = { listenerId: 7, previousListenerIds: [3, 4] };

  it('the listener of record gets LISTENER', () => {
    expect(resolveChatAccess(chat, 7, [])).toBe(HelplineAccess.LISTENER);
  });

  it('a previous listener gets READ_ONLY', () => {
    expect(resolveChatAccess(chat, 4, [])).toBe(HelplineAccess.READ_ONLY);
  });

  it('a monitoring supervisor gets READ_ONLY', () => {
    expect(
      resolveChatAccess(chat, 99, [PERMISSIONS.VIEW_HELPLINE_MONITOR]),
    ).toBe(HelplineAccess.READ_ONLY);
  });

  it('a stranger — even a fellow listener — gets nothing (callers answer 404)', () => {
    expect(
      resolveChatAccess(chat, 99, [
        PERMISSIONS.VIEW_HELPLINE_LOBBY,
        PERMISSIONS.VIEW_HELPLINE_CHAT,
      ]),
    ).toBeNull();
  });

  it('nobody is the listener of an unclaimed chat', () => {
    expect(
      resolveChatAccess({ listenerId: null, previousListenerIds: [] }, 7, []),
    ).toBeNull();
  });
});
