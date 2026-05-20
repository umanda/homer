import { logger } from '@/core/services/logger';
import {
  fetchSlackUserFromEmails,
  slackBotWebClient,
} from '@/core/services/slack';
import { slackUserFixture } from '../../__fixtures__/slackUserFixture';

function usersNotFoundError(): Error {
  return Object.assign(new Error('An API error occurred: users_not_found'), {
    code: 'slack_webapi_platform_error',
    data: { ok: false, error: 'users_not_found' },
  });
}

function rateLimitedError(): Error {
  return Object.assign(new Error('A rate limit was exceeded'), {
    code: 'slack_webapi_rate_limited_error',
    data: { ok: false, error: 'ratelimited' },
  });
}

describe('fetchSlackUserFromEmails', () => {
  const lookupByEmail = slackBotWebClient.users.lookupByEmail as jest.Mock;

  it('returns the user when the first email matches and logs nothing', async () => {
    lookupByEmail.mockResolvedValueOnce({ user: slackUserFixture });

    const result = await fetchSlackUserFromEmails(['first@example.com']);

    expect(result).toEqual(slackUserFixture);
    expect(lookupByEmail).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('falls through to the next email when the first returns users_not_found', async () => {
    lookupByEmail
      .mockRejectedValueOnce(usersNotFoundError())
      .mockResolvedValueOnce({ user: slackUserFixture });

    const result = await fetchSlackUserFromEmails([
      'first@a.com',
      'second@b.com',
    ]);

    expect(result).toEqual(slackUserFixture);
    expect(lookupByEmail).toHaveBeenCalledTimes(2);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs at info (not error) when every email returns users_not_found', async () => {
    lookupByEmail
      .mockRejectedValueOnce(usersNotFoundError())
      .mockRejectedValueOnce(usersNotFoundError());

    const result = await fetchSlackUserFromEmails(['gone@a.com', 'gone@b.com']);

    expect(result).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        emails: ['gone@a.com', 'gone@b.com'],
        slackError: 'users_not_found',
      }),
      'no slack user found for emails',
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs at warn when a transient Slack error is encountered', async () => {
    lookupByEmail.mockRejectedValueOnce(rateLimitedError());

    const result = await fetchSlackUserFromEmails(['user@a.com']);

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          data: expect.objectContaining({ error: 'ratelimited' }),
        }),
        emails: ['user@a.com'],
      }),
      'slack user lookup failed',
    );
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs at warn when at least one lookup throws a transient error, even if another returns users_not_found', async () => {
    lookupByEmail
      .mockRejectedValueOnce(usersNotFoundError())
      .mockRejectedValueOnce(rateLimitedError());

    const result = await fetchSlackUserFromEmails([
      'gone@a.com',
      'flaky@b.com',
    ]);

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          data: expect.objectContaining({ error: 'ratelimited' }),
        }),
        emails: ['gone@a.com', 'flaky@b.com'],
      }),
      'slack user lookup failed',
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('returns undefined without logging on an empty input', async () => {
    const result = await fetchSlackUserFromEmails([]);

    expect(result).toBeUndefined();
    expect(lookupByEmail).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
