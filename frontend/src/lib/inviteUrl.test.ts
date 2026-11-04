import { describe, expect, it } from 'vitest';
import { stripInviteParams } from './inviteUrl';

const INVITE_SIGN_UP =
  'https://app.getcito.com/en/sign-up?invite=tok_123&email=cal%40acme.test&next=%2Fen%2Finvite%2Ftok_123';

describe('stripInviteParams', () => {
  it("takes an invitation's token, address and way back out of the address bar", () => {
    expect(stripInviteParams(INVITE_SIGN_UP)).toBe('/en/sign-up');
  });

  it('keeps the rest of the query', () => {
    expect(
      stripInviteParams('https://app.getcito.com/en/sign-up?invite=t&email=a%40b.test&plan=growth'),
    ).toBe('/en/sign-up?plan=growth');
    expect(
      stripInviteParams(
        'https://app.getcito.com/en/sign-up?email=a%40b.test&next=%2Fen%2Fdashboard%2Fchat',
      ),
    ).toBe('/en/sign-up?next=%2Fen%2Fdashboard%2Fchat');
  });

  it('changes nothing on a sign-up without an invitation', () => {
    expect(stripInviteParams('https://app.getcito.com/en/sign-up')).toBeNull();
    expect(
      stripInviteParams('https://app.getcito.com/en/sign-up?next=%2Fen%2Fdashboard%2Fchat'),
    ).toBeNull();
  });
});
