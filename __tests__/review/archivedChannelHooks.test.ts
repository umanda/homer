import request from 'supertest';
import { app } from '@/app';
import { HTTP_STATUS_OK } from '@/constants';
import { addReviewToChannel } from '@/core/services/data';
import { logger } from '@/core/services/logger';
import { slackBotWebClient } from '@/core/services/slack';
import { mergeRequestHookFixture } from '../__fixtures__/hooks/mergeRequestHookFixture';
import { pushHookFixture } from '../__fixtures__/hooks/pushHookFixture';
import { mergeRequestFixture } from '../__fixtures__/mergeRequestFixture';
import { mergeRequestNoteHookFixture } from '../__fixtures__/mergeRequestNoteBody';
import { userDetailsFixture } from '../__fixtures__/userDetailsFixture';
import { getGitlabHeaders } from '../utils/getGitlabHeaders';
import { mockBuildReviewMessageCalls } from '../utils/mockBuildReviewMessageCalls';
import { mockGitlabCall } from '../utils/mockGitlabCall';
import { waitFor } from '../utils/waitFor';

function archivedChannelError(): Error {
  return Object.assign(new Error('An API error occurred: is_archived'), {
    code: 'slack_webapi_platform_error',
    data: { ok: false, error: 'is_archived' },
  });
}

describe('archived-channel handling', () => {
  beforeEach(() => {
    (slackBotWebClient.users.lookupByEmail as jest.Mock).mockImplementation(
      ({ email }: { email: string }) => {
        const name = email.split('@')[0];
        return Promise.resolve({
          user: {
            name,
            profile: { image_24: 'image_24', image_72: 'image_72' },
            real_name: `${name}.real`,
          },
        });
      },
    );
  });

  it('mergeRequestHookHandler: removes the orphan Review row and logs at info when chat.update returns is_archived', async () => {
    // Given
    const { object_attributes, project } = mergeRequestHookFixture;
    const channelId = 'channelId';
    await addReviewToChannel({
      channelId,
      mergeRequestIid: object_attributes.iid,
      projectId: project.id,
      ts: 'ts',
    });
    mockBuildReviewMessageCalls();
    (slackBotWebClient.chat.update as jest.Mock).mockRejectedValueOnce(
      archivedChannelError(),
    );

    // When
    const response = await request(app)
      .post('/api/v1/homer/gitlab')
      .set(getGitlabHeaders())
      .send({
        ...mergeRequestHookFixture,
        object_attributes: { ...object_attributes, action: 'approved' },
      });

    // Then
    expect(response.status).toEqual(HTTP_STATUS_OK);
    const { hasModelEntry } = (await import('sequelize')) as any;
    await waitFor(async () => {
      expect(
        await hasModelEntry('Review', {
          channelId,
          mergeRequestIid: object_attributes.iid,
          ts: 'ts',
        }),
      ).toBe(false);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          hook: 'merge_request',
          mrIid: object_attributes.iid,
          projectId: project.id,
          channelId,
          reviewTs: 'ts',
          slackError: 'is_archived',
        }),
        'slack channel archived; removing orphan review',
      );
    });
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({ hook: 'merge_request' }),
      'webhook slack work failed',
    );
  });

  it('noteHookHandler: removes the orphan Review row and logs at info when chat.update returns is_archived', async () => {
    // Given
    const channelId = 'channelId';
    await addReviewToChannel({
      channelId,
      mergeRequestIid: mergeRequestFixture.iid,
      projectId: mergeRequestFixture.project_id,
      ts: 'ts',
    });
    mockBuildReviewMessageCalls();
    mockGitlabCall(
      `/users/${mergeRequestNoteHookFixture.object_attributes.author_id}`,
      userDetailsFixture,
    );
    (slackBotWebClient.chat.update as jest.Mock).mockRejectedValueOnce(
      archivedChannelError(),
    );
    jest.useFakeTimers();

    // When
    const response = await request(app)
      .post('/api/v1/homer/gitlab')
      .set(getGitlabHeaders())
      .send(mergeRequestNoteHookFixture);
    jest.runAllTimers();
    jest.useRealTimers();

    // Then
    expect(response.status).toEqual(HTTP_STATUS_OK);
    const { hasModelEntry } = (await import('sequelize')) as any;
    await waitFor(async () => {
      expect(
        await hasModelEntry('Review', {
          channelId,
          mergeRequestIid: mergeRequestFixture.iid,
          ts: 'ts',
        }),
      ).toBe(false);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          hook: 'note',
          mrIid: mergeRequestFixture.iid,
          projectId: mergeRequestFixture.project_id,
          channelId,
          reviewTs: 'ts',
          slackError: 'is_archived',
        }),
        'slack channel archived; removing orphan review',
      );
    });
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({ hook: 'note' }),
      'webhook slack work failed',
    );
  });

  it('pushHookHandler: removes the orphan Review row and logs at info when chat.postMessage returns is_archived', async () => {
    // Given
    const branchName = 'master';
    const channelId = 'channelId';
    mockGitlabCall(
      `/projects/${pushHookFixture.project_id}/merge_requests?source_branch=${branchName}`,
      [mergeRequestFixture],
    );
    mockGitlabCall(
      `/projects/${pushHookFixture.project_id}/merge_requests/${mergeRequestFixture.iid}/commits?per_page=100`,
      [{ id: pushHookFixture.commits[1].id }],
    );
    await addReviewToChannel({
      channelId,
      mergeRequestIid: mergeRequestFixture.iid,
      projectId: mergeRequestFixture.project_id,
      ts: 'ts',
    });
    (slackBotWebClient.chat.postMessage as jest.Mock).mockRejectedValueOnce(
      archivedChannelError(),
    );

    // When
    const response = await request(app)
      .post('/api/v1/homer/gitlab')
      .set(getGitlabHeaders())
      .send(pushHookFixture);

    // Then
    expect(response.status).toEqual(HTTP_STATUS_OK);
    const { hasModelEntry } = (await import('sequelize')) as any;
    await waitFor(async () => {
      expect(
        await hasModelEntry('Review', {
          channelId,
          mergeRequestIid: mergeRequestFixture.iid,
          ts: 'ts',
        }),
      ).toBe(false);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          hook: 'push',
          mrIid: mergeRequestFixture.iid,
          projectId: pushHookFixture.project_id,
          channelId,
          reviewTs: 'ts',
          slackError: 'is_archived',
        }),
        'slack channel archived; removing orphan review',
      );
    });
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({ hook: 'push' }),
      'webhook slack work failed',
    );
  });
});
