import { autoBindMethodsForReact } from 'class-autobind-decorator';
import { clipboard, ipcRenderer, SaveDialogOptions } from 'electron';
import fs from 'fs';
import HTTPSnippet from 'httpsnippet';
import { extension as mimeExtension } from 'mime-types';
import * as path from 'path';
import React, { createRef, PureComponent } from 'react';
import { connect } from 'react-redux';
import { Action, bindActionCreators, Dispatch } from 'redux';
import { parse as urlParse } from 'url';

import {  SegmentEvent, trackSegmentEvent } from '../../common/analytics';
import {
  ACTIVITY_HOME,
  AUTOBIND_CFG,
  COLLAPSE_SIDEBAR_REMS,
  DEFAULT_PANE_HEIGHT,
  DEFAULT_PANE_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  getProductName,
  isDevelopment,
  MAX_PANE_HEIGHT,
  MAX_PANE_WIDTH,
  MAX_SIDEBAR_REMS,
  MIN_PANE_HEIGHT,
  MIN_PANE_WIDTH,
  MIN_SIDEBAR_REMS,
  PreviewMode,
  SortOrder,
} from '../../common/constants';
import { type ChangeBufferEvent, database as db } from '../../common/database';
import { getDataDirectory } from '../../common/electron-helpers';
import { exportHarRequest } from '../../common/har';
import { hotKeyRefs } from '../../common/hotkeys';
import { executeHotKey } from '../../common/hotkeys-listener';
import {
  debounce,
  generateId,
  getContentDispositionHeader,
} from '../../common/misc';
import { sortMethodMap } from '../../common/sorting';
import * as models from '../../models';
import { isEnvironment } from '../../models/environment';
import { GrpcRequest, isGrpcRequest, isGrpcRequestId } from '../../models/grpc-request';
import { GrpcRequestMeta } from '../../models/grpc-request-meta';
import * as requestOperations from '../../models/helpers/request-operations';
import { isNotDefaultProject } from '../../models/project';
import { Request, updateMimeType } from '../../models/request';
import { isRequestGroup, RequestGroup } from '../../models/request-group';
import { type RequestGroupMeta } from '../../models/request-group-meta';
import { RequestMeta } from '../../models/request-meta';
import { Response } from '../../models/response';
import { isWorkspace } from '../../models/workspace';
import { WorkspaceMeta } from '../../models/workspace-meta';
import * as network from '../../network/network';
import * as plugins from '../../plugins';
import * as themes from '../../plugins/misc';
import { fsClient } from '../../sync/git/fs-client';
import { GIT_CLONE_DIR, GIT_INSOMNIA_DIR, GIT_INTERNAL_DIR, GitVCS } from '../../sync/git/git-vcs';
import { NeDBClient } from '../../sync/git/ne-db-client';
import { routableFSClient } from '../../sync/git/routable-fs-client';
import FileSystemDriver from '../../sync/store/drivers/file-system-driver';
import { type MergeConflict } from '../../sync/types';
import { VCS } from '../../sync/vcs/vcs';
import * as templating from '../../templating/index';
import { ErrorBoundary } from '../components/error-boundary';
import { KeydownBinder } from '../components/keydown-binder';
import { AskModal } from '../components/modals/ask-modal';
import { showCookiesModal } from '../components/modals/cookies-modal';
import { GenerateCodeModal } from '../components/modals/generate-code-modal';
import { showAlert, showModal, showPrompt } from '../components/modals/index';
import { RequestRenderErrorModal } from '../components/modals/request-render-error-modal';
import { RequestSettingsModal } from '../components/modals/request-settings-modal';
import RequestSwitcherModal from '../components/modals/request-switcher-modal';
import { showSelectModal } from '../components/modals/select-modal';
import { SettingsModal, TAB_INDEX_SHORTCUTS } from '../components/modals/settings-modal';
import { SyncMergeModal } from '../components/modals/sync-merge-modal';
import { WorkspaceEnvironmentsEditModal } from '../components/modals/workspace-environments-edit-modal';
import { WorkspaceSettingsModal } from '../components/modals/workspace-settings-modal';
import { Toast } from '../components/toast';
import { Wrapper } from '../components/wrapper';
import withDragDropContext from '../context/app/drag-drop-context';
import { GrpcProvider } from '../context/grpc';
import { NunjucksEnabledProvider } from '../context/nunjucks/nunjucks-enabled-context';
import { createRequestGroup } from '../hooks/create-request-group';
import { RootState } from '../redux/modules';
import { initialize } from '../redux/modules/entities';
import {
  exportRequestsToFile,
  loadRequestStart,
  loadRequestStop,
  newCommand,
  selectIsLoading,
  setActiveActivity,
} from '../redux/modules/global';
import { importUri } from '../redux/modules/import';
import { activateWorkspace } from '../redux/modules/workspace';
import {
  selectActiveActivity,
  selectActiveApiSpec,
  selectActiveCookieJar,
  selectActiveEnvironment,
  selectActiveGitRepository,
  selectActiveProject,
  selectActiveRequest,
  selectActiveRequestResponses,
  selectActiveResponse,
  selectActiveUnitTestResult,
  selectActiveUnitTests,
  selectActiveUnitTestSuite,
  selectActiveUnitTestSuites,
  selectActiveWorkspace,
  selectActiveWorkspaceClientCertificates,
  selectActiveWorkspaceMeta,
  selectActiveWorkspaceName,
  selectApiSpecs,
  selectEnvironments,
  selectGitRepositories,
  selectIsFinishedBooting,
  selectIsLoggedIn,
  selectLoadStartTime,
  selectRequestGroups,
  selectRequestMetas,
  selectRequests,
  selectRequestVersions,
  selectResponseDownloadPath,
  selectResponseFilter,
  selectResponseFilterHistory,
  selectResponsePreviewMode,
  selectSettings,
  selectStats,
  selectSyncItems,
  selectUnseenWorkspaces,
  selectWorkspaceMetas,
  selectWorkspacesForActiveProject,
} from '../redux/selectors';
import { selectPaneHeight, selectPaneWidth, selectSidebarChildren, selectSidebarFilter, selectSidebarHidden, selectSidebarWidth } from '../redux/sidebar-selectors';
import { AppHooks } from './app-hooks';

const updateRequestMetaByParentId = async (
  requestId: string,
  patch: Partial<GrpcRequestMeta> | Partial<RequestMeta>
) => {
  const isGrpc = isGrpcRequestId(requestId);

  if (isGrpc) {
    return models.grpcRequestMeta.updateOrCreateByParentId(requestId, patch);
  } else {
    return models.requestMeta.updateOrCreateByParentId(requestId, patch);
  }
};

export type AppProps = ReturnType<typeof mapStateToProps> & ReturnType<typeof mapDispatchToProps>;

interface State {
  showDragOverlay: boolean;
  draggingSidebar: boolean;
  draggingPaneHorizontal: boolean;
  draggingPaneVertical: boolean;
  sidebarWidth: number;
  paneWidth: number;
  paneHeight: number;
  vcs: VCS | null;
  gitVCS: GitVCS | null;
  forceRefreshCounter: number;
  forceRefreshHeaderCounter: number;
  isMigratingChildren: boolean;
}

@autoBindMethodsForReact(AUTOBIND_CFG)
class App extends PureComponent<AppProps, State> {
  private _savePaneWidth: (paneWidth: number) => void;
  private _savePaneHeight: (paneWidth: number) => void;
  private _saveSidebarWidth: (paneWidth: number) => void;
  private _globalKeyMap: any;
  private _updateVCSLock: any;
  private _requestPaneRef = createRef<HTMLElement>();
  private _responsePaneRef = createRef<HTMLElement>();
  private _sidebarRef = createRef<HTMLElement>();
  private _wrapper: Wrapper | null = null;
  private _responseFilterHistorySaveTimeout: NodeJS.Timeout | null = null;

  constructor(props: AppProps) {
    super(props);

    this.state = {
      showDragOverlay: false,
      draggingSidebar: false,
      draggingPaneHorizontal: false,
      draggingPaneVertical: false,
      sidebarWidth: props.sidebarWidth || DEFAULT_SIDEBAR_WIDTH,
      paneWidth: props.paneWidth || DEFAULT_PANE_WIDTH,
      paneHeight: props.paneHeight || DEFAULT_PANE_HEIGHT,
      vcs: null,
      gitVCS: null,
      forceRefreshCounter: 0,
      forceRefreshHeaderCounter: 0,
      isMigratingChildren: false,
    };

    this._savePaneWidth = debounce(paneWidth =>
      this._updateActiveWorkspaceMeta({ paneWidth }),
    );
    this._savePaneHeight = debounce(paneHeight =>
      this._updateActiveWorkspaceMeta({ paneHeight }),
    );
    this._saveSidebarWidth = debounce(sidebarWidth =>
      this._updateActiveWorkspaceMeta({ sidebarWidth }),
    );
    this._globalKeyMap = null;
    this._updateVCSLock = null;
  }

  _setGlobalKeyMap() {
    this._globalKeyMap = [
      [
        hotKeyRefs.PREFERENCES_SHOW_GENERAL,
        () => {
          App._handleShowSettingsModal();
        },
      ],
      [
        hotKeyRefs.PREFERENCES_SHOW_KEYBOARD_SHORTCUTS,
        () => {
          App._handleShowSettingsModal(TAB_INDEX_SHORTCUTS);
        },
      ],
      [
        hotKeyRefs.SHOW_RECENT_REQUESTS,
        () => {
          showModal(RequestSwitcherModal, {
            disableInput: true,
            maxRequests: 10,
            maxWorkspaces: 0,
            selectOnKeyup: true,
            title: 'Recent Requests',
            hideNeverActiveRequests: true,
            // Add an open delay so the dialog won't show for quick presses
            openDelay: 150,
          });
        },
      ],
      [
        hotKeyRefs.WORKSPACE_SHOW_SETTINGS,
        () => {
          const { activeWorkspace } = this.props;
          showModal(WorkspaceSettingsModal, activeWorkspace);
        },
      ],
      [
        hotKeyRefs.REQUEST_SHOW_SETTINGS,
        () => {
          if (this.props.activeRequest) {
            showModal(RequestSettingsModal, {
              request: this.props.activeRequest,
            });
          }
        },
      ],
      [
        hotKeyRefs.REQUEST_QUICK_SWITCH,
        () => {
          showModal(RequestSwitcherModal);
        },
      ],
      [hotKeyRefs.REQUEST_SEND, this._handleSendShortcut],
      [
        hotKeyRefs.ENVIRONMENT_SHOW_EDITOR,
        () => {
          const { activeWorkspace } = this.props;
          showModal(WorkspaceEnvironmentsEditModal, activeWorkspace);
        },
      ],
      [hotKeyRefs.SHOW_COOKIES_EDITOR, showCookiesModal],
      [
        hotKeyRefs.REQUEST_CREATE_HTTP,
        async () => {
          const { activeRequest, activeWorkspace } = this.props;
          if (!activeWorkspace) {
            return;
          }

          const parentId = activeRequest ? activeRequest.parentId : activeWorkspace._id;
          const request = await models.request.create({
            parentId,
            name: 'New Request',
          });
          await this._handleSetActiveRequest(request._id);
          models.stats.incrementCreatedRequests();
          trackSegmentEvent(SegmentEvent.requestCreate, { requestType: 'HTTP' });
        },
      ],
      [
        hotKeyRefs.REQUEST_SHOW_DELETE,
        () => {
          const { activeRequest } = this.props;

          if (!activeRequest) {
            return;
          }

          showModal(AskModal, {
            title: 'Delete Request?',
            message: `Really delete ${activeRequest.name}?`,
            onDone: async (confirmed: boolean) => {
              if (!confirmed) {
                return;
              }

              await requestOperations.remove(activeRequest);
              models.stats.incrementDeletedRequests();
            },
          });
        },
      ],
      [
        hotKeyRefs.REQUEST_SHOW_CREATE_FOLDER,
        () => {
          const { activeRequest, activeWorkspace } = this.props;
          if (!activeWorkspace) {
            return;
          }

          const parentId = activeRequest ? activeRequest.parentId : activeWorkspace._id;
          createRequestGroup(parentId);
        },
      ],
      [
        hotKeyRefs.REQUEST_SHOW_GENERATE_CODE_EDITOR,
        async () => {
          showModal(GenerateCodeModal, this.props.activeRequest);
        },
      ],
      [
        hotKeyRefs.REQUEST_SHOW_DUPLICATE,
        async () => {
          await this._requestDuplicate(this.props.activeRequest || undefined);
        },
      ],
      [
        hotKeyRefs.REQUEST_TOGGLE_PIN,
        async () => {
          // @ts-expect-error -- TSCONVERSION apparently entities doesn't exist on props
          const { activeRequest, entities } = this.props;

          if (!activeRequest) {
            return;
          }

          const entitiesToCheck = isGrpcRequest(activeRequest)
            ? entities.grpcRequestMetas
            : entities.requestMetas;
          const meta = Object.values<GrpcRequestMeta | RequestMeta>(entitiesToCheck).find(m => m.parentId === activeRequest._id);
          await this._handleSetRequestPinned(activeRequest, !meta?.pinned);
        },
      ],
      [hotKeyRefs.PLUGIN_RELOAD, this._handleReloadPlugins],
      [hotKeyRefs.ENVIRONMENT_SHOW_VARIABLE_SOURCE_AND_VALUE, this._updateShowVariableSourceAndValue],
      [
        hotKeyRefs.SIDEBAR_TOGGLE,
        () => {
          this._handleToggleSidebar();
        },
      ],
    ];
  }

  async _handleSendShortcut() {
    const { activeRequest, activeEnvironment } = this.props;
    await this._handleSendRequestWithEnvironment(
      activeRequest ? activeRequest._id : 'n/a',
      activeEnvironment ? activeEnvironment._id : 'n/a',
    );
  }

  async _recalculateMetaSortKey(docs: (RequestGroup | Request | GrpcRequest)[]) {
    function __updateDoc(doc: RequestGroup | Request | GrpcRequest, metaSortKey: number) {
      // @ts-expect-error -- TSCONVERSION the fetched model will only ever be a RequestGroup, Request, or GrpcRequest
      // Which all have the .update method. How do we better filter types?
      return models.getModel(doc.type)?.update(doc, {
        metaSortKey,
      });
    }

    return Promise.all(docs.map((doc, i) => __updateDoc(doc, i * 100)));
  }

  async _sortSidebar(order: SortOrder, parentId?: string) {
    let flushId: number | undefined;

    if (!this.props.activeWorkspace) {
      return;
    }

    if (!parentId) {
      parentId = this.props.activeWorkspace._id;
      flushId = await db.bufferChanges();
    }

    const docs = [
      ...(await models.requestGroup.findByParentId(parentId)),
      ...(await models.request.findByParentId(parentId)),
      ...(await models.grpcRequest.findByParentId(parentId)),
    ].sort(sortMethodMap[order]);
    await this._recalculateMetaSortKey(docs);
    // sort RequestGroups recursively
    await Promise.all(docs.filter(isRequestGroup).map(g => this._sortSidebar(order, g._id)));

    if (flushId) {
      await db.flushChanges(flushId);
    }
  }

  static async _requestGroupDuplicate(requestGroup: RequestGroup) {
    showPrompt({
      title: 'Duplicate Folder',
      defaultValue: requestGroup.name,
      submitName: 'Create',
      label: 'New Name',
      selectText: true,
      onComplete: async (name: string) => {
        const newRequestGroup = await models.requestGroup.duplicate(requestGroup, {
          name,
        });
        models.stats.incrementCreatedRequestsForDescendents(newRequestGroup);
      },
    });
  }

  _requestDuplicate(request?: Request | GrpcRequest) {
    if (!request) {
      return;
    }

    showPrompt({
      title: 'Duplicate Request',
      defaultValue: request.name,
      submitName: 'Create',
      label: 'New Name',
      selectText: true,
      onComplete: async (name: string) => {
        const newRequest = await requestOperations.duplicate(request, {
          name,
        });
        await this._handleSetActiveRequest(newRequest._id);
        models.stats.incrementCreatedRequests();
      },
    });
  }

  _handleGenerateCodeForActiveRequest() {
    // @ts-expect-error -- TSCONVERSION should skip this if active request is grpc request
    App._handleGenerateCode(this.props.activeRequest);
  }

  static _handleGenerateCode(request: Request) {
    showModal(GenerateCodeModal, request);
  }

  async _handleCopyAsCurl(request: Request) {
    const { activeEnvironment } = this.props;
    const environmentId = activeEnvironment ? activeEnvironment._id : 'n/a';
    const har = await exportHarRequest(request._id, environmentId);
    const snippet = new HTTPSnippet(har);
    const cmd = snippet.convert('shell', 'curl');

    // @TODO Should we throw otherwise? What should happen if we cannot find cmd?
    if (cmd) {
      clipboard.writeText(cmd);
    }
  }

  static async _updateRequestGroupMetaByParentId(requestGroupId: string, patch: Partial<RequestGroupMeta>) {
    const requestGroupMeta = await models.requestGroupMeta.getByParentId(requestGroupId);

    if (requestGroupMeta) {
      await models.requestGroupMeta.update(requestGroupMeta, patch);
    } else {
      const newPatch = Object.assign(
        {
          parentId: requestGroupId,
        },
        patch,
      );
      await models.requestGroupMeta.create(newPatch);
    }
  }

  async _updateActiveWorkspaceMeta(patch: Partial<WorkspaceMeta>) {
    const { activeWorkspaceMeta } = this.props;

    if (activeWorkspaceMeta) {
      await models.workspaceMeta.update(activeWorkspaceMeta, patch);
    }
  }

  async _updateShowVariableSourceAndValue() {
    const { settings } = this.props;
    await models.settings.update(settings, { showVariableSourceAndValue: !settings.showVariableSourceAndValue });
  }

  _handleSetPaneWidth(paneWidth: number) {
    this.setState({
      paneWidth,
    });

    this._savePaneWidth(paneWidth);
  }

  _handleSetPaneHeight(paneHeight: number) {
    this.setState({
      paneHeight,
    });

    this._savePaneHeight(paneHeight);
  }

  async _handleSetActiveRequest(activeRequestId: string) {
    await this._updateActiveWorkspaceMeta({
      activeRequestId,
    });
    await updateRequestMetaByParentId(activeRequestId, {
      lastActive: Date.now(),
    });
  }

  async _handleSetActiveEnvironment(activeEnvironmentId: string | null) {
    await this._updateActiveWorkspaceMeta({
      activeEnvironmentId,
    });
    // Give it time to update and re-render
    setTimeout(() => {
      this._wrapper?._forceRequestPaneRefresh();
    }, 300);
  }

  _handleSetSidebarWidth(sidebarWidth: number) {
    this.setState({
      sidebarWidth,
    });

    this._saveSidebarWidth(sidebarWidth);
  }

  async _handleSetSidebarHidden(sidebarHidden: boolean) {
    await this._updateActiveWorkspaceMeta({
      sidebarHidden,
    });
  }

  async _handleSetSidebarFilter(sidebarFilter: string) {
    await this._updateActiveWorkspaceMeta({
      sidebarFilter,
    });
  }

  _handleSetRequestGroupCollapsed(requestGroupId: string, collapsed: boolean) {
    App._updateRequestGroupMetaByParentId(requestGroupId, {
      collapsed,
    });
  }

  async _handleSetRequestPinned(request: Request | GrpcRequest, pinned: boolean) {
    updateRequestMetaByParentId(request._id, {
      pinned,
    });
  }

  _handleSetResponsePreviewMode(requestId: string, previewMode: PreviewMode) {
    updateRequestMetaByParentId(requestId, {
      previewMode,
    });
  }

  _handleUpdateDownloadPath(requestId: string, downloadPath: string) {
    updateRequestMetaByParentId(requestId, {
      downloadPath,
    });
  }

  async _handleSetResponseFilter(requestId: string, responseFilter: string) {
    await updateRequestMetaByParentId(requestId, {
      responseFilter,
    });

    if (this._responseFilterHistorySaveTimeout !== null) {
      clearTimeout(this._responseFilterHistorySaveTimeout);
    }
    this._responseFilterHistorySaveTimeout = setTimeout(async () => {
      const meta = await models.requestMeta.getByParentId(requestId);
      // @ts-expect-error -- TSCONVERSION meta can be null
      const responseFilterHistory = meta.responseFilterHistory.slice(0, 10);

      // Already in history?
      if (responseFilterHistory.includes(responseFilter)) {
        return;
      }

      // Blank?
      if (!responseFilter) {
        return;
      }

      responseFilterHistory.unshift(responseFilter);
      await updateRequestMetaByParentId(requestId, {
        responseFilterHistory,
      });
    }, 2000);
  }

  async _handleUpdateRequestMimeType(mimeType: string | null): Promise<Request | null> {
    if (!this.props.activeRequest) {
      console.warn('Tried to update request mime-type when no active request');
      return null;
    }

    const requestMeta = await models.requestMeta.getOrCreateByParentId(
      this.props.activeRequest._id,
    );
    const savedBody = requestMeta.savedRequestBody;
    const saveValue =
      typeof mimeType !== 'string' // Switched to No body
        ? this.props.activeRequest.body
        : {};
    // Clear saved value in requestMeta
    await models.requestMeta.update(requestMeta, {
      savedRequestBody: saveValue,
    });
    // @ts-expect-error -- TSCONVERSION should skip this if active request is grpc request
    const newRequest = await updateMimeType(this.props.activeRequest, mimeType, false, savedBody);
    // Force it to update, because other editor components (header editor)
    // needs to change. Need to wait a delay so the next render can finish
    setTimeout(() => {
      this.setState({
        forceRefreshHeaderCounter: this.state.forceRefreshHeaderCounter + 1,
      });
    }, 500);
    return newRequest;
  }

  async _getDownloadLocation() {
    const options: SaveDialogOptions = {
      title: 'Select Download Location',
      buttonLabel: 'Save',
    };
    const defaultPath = window.localStorage.getItem('insomnia.sendAndDownloadLocation');

    if (defaultPath) {
      // NOTE: An error will be thrown if defaultPath is supplied but not a String
      options.defaultPath = defaultPath;
    }

    const { filePath } = await window.dialog.showSaveDialog(options);
    // @ts-expect-error -- TSCONVERSION don't set item if filePath is undefined
    window.localStorage.setItem('insomnia.sendAndDownloadLocation', filePath);
    return filePath || null;
  }

  async _handleSendAndDownloadRequestWithEnvironment(requestId: string, environmentId: string, dir: string) {
    const { settings, handleStartLoading, handleStopLoading } = this.props;
    const request = await models.request.getById(requestId);

    if (!request) {
      return;
    }

    // Update request stats
    models.stats.incrementExecutedRequests();
    trackSegmentEvent(SegmentEvent.requestExecute, {
      preferredHttpVersion: settings.preferredHttpVersion,
      authenticationType: request.authentication?.type,
      mimeType: request.body.mimeType,
    });
    // Start loading
    handleStartLoading(requestId);

    try {
      const responsePatch = await network.send(requestId, environmentId);
      const headers = responsePatch.headers || [];
      const header = getContentDispositionHeader(headers);
      const nameFromHeader = header ? header.value : null;

      if (
        responsePatch.bodyPath &&
        responsePatch.statusCode &&
        responsePatch.statusCode >= 200 &&
        responsePatch.statusCode < 300
      ) {
        const sanitizedExtension = responsePatch.contentType && mimeExtension(responsePatch.contentType);
        const extension = sanitizedExtension || 'unknown';
        const name =
          nameFromHeader || `${request.name.replace(/\s/g, '-').toLowerCase()}.${extension}`;
        let filename: string | null;

        if (dir) {
          filename = path.join(dir, name);
        } else {
          filename = await this._getDownloadLocation();
        }

        if (!filename) {
          return;
        }

        const to = fs.createWriteStream(filename);
        // @ts-expect-error -- TSCONVERSION
        const readStream = models.response.getBodyStream(responsePatch);

        if (!readStream) {
          return;
        }

        readStream.pipe(to);

        readStream.on('end', async () => {
          responsePatch.error = `Saved to ${filename}`;
          await models.response.create(responsePatch, settings.maxHistoryResponses);
        });

        readStream.on('error', async err => {
          console.warn('Failed to download request after sending', responsePatch.bodyPath, err);
          await models.response.create(responsePatch, settings.maxHistoryResponses);
        });
      } else {
        // Save the bad responses so failures are shown still
        await models.response.create(responsePatch, settings.maxHistoryResponses);
      }
    } catch (err) {
      showAlert({
        title: 'Unexpected Request Failure',
        message: (
          <div>
            <p>The request failed due to an unhandled error:</p>
            <code className="wide selectable">
              <pre>{err.message}</pre>
            </code>
          </div>
        ),
      });
    } finally {
      // Unset active response because we just made a new one
      await updateRequestMetaByParentId(requestId, {
        activeResponseId: null,
      });
      // Stop loading
      handleStopLoading(requestId);
    }
  }

  async _handleSendRequestWithEnvironment(requestId: string, environmentId?: string) {
    const { handleStartLoading, handleStopLoading, settings } = this.props;
    const request = await models.request.getById(requestId);

    if (!request) {
      return;
    }

    // Update request stats
    models.stats.incrementExecutedRequests();
    trackSegmentEvent(SegmentEvent.requestExecute, {
      preferredHttpVersion: settings.preferredHttpVersion,
      authenticationType: request.authentication?.type,
      mimeType: request.body.mimeType,
    });
    handleStartLoading(requestId);

    try {
      const responsePatch = await network.send(requestId, environmentId);
      await models.response.create(responsePatch, settings.maxHistoryResponses);

    } catch (err) {
      if (err.type === 'render') {
        showModal(RequestRenderErrorModal, {
          request,
          error: err,
        });
      } else {
        showAlert({
          title: 'Unexpected Request Failure',
          message: (
            <div>
              <p>The request failed due to an unhandled error:</p>
              <code className="wide selectable">
                <pre>{err.message}</pre>
              </code>
            </div>
          ),
        });
      }
    }

    // Unset active response because we just made a new one
    await updateRequestMetaByParentId(requestId, {
      activeResponseId: null,
    });

    // Stop loading
    handleStopLoading(requestId);
  }

  async _handleSetActiveResponse(requestId: string, activeResponse: Response | null = null) {
    const { activeEnvironment } = this.props;
    const activeResponseId = activeResponse ? activeResponse._id : null;
    await updateRequestMetaByParentId(requestId, {
      activeResponseId,
    });

    let response: Response;

    if (activeResponseId) {
      // @ts-expect-error -- TSCONVERSION can return null if not found
      response = await models.response.getById(activeResponseId);
    } else {
      const environmentId = activeEnvironment ? activeEnvironment._id : null;
      // @ts-expect-error -- TSCONVERSION can return null if not found
      response = await models.response.getLatestForRequest(requestId, environmentId);
    }

    const requestVersionId = response ? response.requestVersionId : 'n/a';
    // @ts-expect-error -- TSCONVERSION the above line should be response?.requestVersionId ?? 'n/a'
    const request = await models.requestVersion.restore(requestVersionId);

    if (request) {
      // Refresh app to reflect changes. Using timeout because we need to
      // wait for the request update to propagate.
      setTimeout(() => this._wrapper?._forceRequestPaneRefresh(), 500);
    } else {
      // Couldn't restore request. That's okay
    }
  }

  _startDragSidebar() {
    this.setState({
      draggingSidebar: true,
    });
  }

  _resetDragSidebar() {
    // TODO: Remove setTimeout need be not triggering drag on double click
    setTimeout(() => this._handleSetSidebarWidth(DEFAULT_SIDEBAR_WIDTH), 50);
  }

  _startDragPaneHorizontal() {
    this.setState({
      draggingPaneHorizontal: true,
    });
  }

  _startDragPaneVertical() {
    this.setState({
      draggingPaneVertical: true,
    });
  }

  _resetDragPaneHorizontal() {
    // TODO: Remove setTimeout need be not triggering drag on double click
    setTimeout(() => this._handleSetPaneWidth(DEFAULT_PANE_WIDTH), 50);
  }

  _resetDragPaneVertical() {
    // TODO: Remove setTimeout need be not triggering drag on double click
    setTimeout(() => this._handleSetPaneHeight(DEFAULT_PANE_HEIGHT), 50);
  }

  _handleMouseMove(event: MouseEvent) {
    if (this.state.draggingPaneHorizontal) {
      // Only pop the overlay after we've moved it a bit (so we don't block doubleclick);
      const distance = this.props.paneWidth - this.state.paneWidth;

      if (
        !this.state.showDragOverlay &&
        Math.abs(distance) > 0.02
        /* % */
      ) {
        this.setState({
          showDragOverlay: true,
        });
      }

      const requestPane = this._requestPaneRef.current;
      const responsePane = this._responsePaneRef.current;

      if (requestPane && responsePane) {
        const requestPaneWidth = requestPane.offsetWidth;
        const responsePaneWidth = responsePane.offsetWidth;

        const pixelOffset = event.clientX - requestPane.offsetLeft;
        let paneWidth = pixelOffset / (requestPaneWidth + responsePaneWidth);
        paneWidth = Math.min(Math.max(paneWidth, MIN_PANE_WIDTH), MAX_PANE_WIDTH);

        this._handleSetPaneWidth(paneWidth);
      }
    } else if (this.state.draggingPaneVertical) {
      // Only pop the overlay after we've moved it a bit (so we don't block doubleclick);
      const distance = this.props.paneHeight - this.state.paneHeight;

      if (
        !this.state.showDragOverlay &&
        Math.abs(distance) > 0.02
        /* % */
      ) {
        this.setState({
          showDragOverlay: true,
        });
      }

      const requestPane = this._requestPaneRef.current;
      const responsePane = this._responsePaneRef.current;

      if (requestPane && responsePane) {
        const requestPaneHeight = requestPane.offsetHeight;
        const responsePaneHeight = responsePane.offsetHeight;
        const pixelOffset = event.clientY - requestPane.offsetTop;
        let paneHeight = pixelOffset / (requestPaneHeight + responsePaneHeight);
        paneHeight = Math.min(Math.max(paneHeight, MIN_PANE_HEIGHT), MAX_PANE_HEIGHT);

        this._handleSetPaneHeight(paneHeight);
      }
    } else if (this.state.draggingSidebar) {
      // Only pop the overlay after we've moved it a bit (so we don't block doubleclick);
      const distance = this.props.sidebarWidth - this.state.sidebarWidth;

      if (
        !this.state.showDragOverlay &&
        Math.abs(distance) > 2
        /* ems */
      ) {
        this.setState({
          showDragOverlay: true,
        });
      }

      const sidebar = this._sidebarRef.current;

      if (sidebar) {
        const currentPixelWidth = sidebar.offsetWidth;

        const ratio = (event.clientX - sidebar.offsetLeft) / currentPixelWidth;
        const width = this.state.sidebarWidth * ratio;
        let sidebarWidth = Math.min(width, MAX_SIDEBAR_REMS);

        if (sidebarWidth < COLLAPSE_SIDEBAR_REMS) {
          sidebarWidth = MIN_SIDEBAR_REMS;
        }

        this._handleSetSidebarWidth(sidebarWidth);
      }
    }
  }

  _handleMouseUp() {
    if (this.state.draggingSidebar) {
      this.setState({
        draggingSidebar: false,
        showDragOverlay: false,
      });
    }

    if (this.state.draggingPaneHorizontal) {
      this.setState({
        draggingPaneHorizontal: false,
        showDragOverlay: false,
      });
    }

    if (this.state.draggingPaneVertical) {
      this.setState({
        draggingPaneVertical: false,
        showDragOverlay: false,
      });
    }
  }

  _handleKeyDown(event: KeyboardEvent) {
    for (const [definition, callback] of this._globalKeyMap) {
      executeHotKey(event, definition, callback);
    }
  }

  async _handleToggleSidebar() {
    const sidebarHidden = !this.props.sidebarHidden;
    await this._handleSetSidebarHidden(sidebarHidden);
  }

  static _handleShowSettingsModal(tabIndex?: number) {
    showModal(SettingsModal, tabIndex);
  }

  _setWrapperRef(wrapper: Wrapper) {
    this._wrapper = wrapper;
  }

  async _handleReloadPlugins() {
    const { settings } = this.props;
    await plugins.reloadPlugins();
    await themes.applyColorScheme(settings);
    templating.reload();
    console.log('[plugins] reloaded');
  }

  /**
   * Update document.title to be "Project - Workspace (Environment) – Request" when not home
   * @private
   */
  _updateDocumentTitle() {
    const {
      activeWorkspace,
      activeProject,
      activeWorkspaceName,
      activeEnvironment,
      activeRequest,
      activeActivity,
    } = this.props;
    let title;

    if (activeActivity === ACTIVITY_HOME) {
      title = getProductName();
    } else if (activeWorkspace && activeWorkspaceName) {
      title = activeProject.name;
      title += ` - ${activeWorkspaceName}`;

      if (activeEnvironment) {
        title += ` (${activeEnvironment.name})`;
      }

      if (activeRequest) {
        title += ` – ${activeRequest.name}`;
      }
    }

    document.title = title || getProductName();
  }

  componentDidUpdate(prevProps: AppProps) {
    this._updateDocumentTitle();

    this._ensureWorkspaceChildren();

    // Force app refresh if login state changes
    if (prevProps.isLoggedIn !== this.props.isLoggedIn) {
      this.setState(state => ({
        forceRefreshCounter: state.forceRefreshCounter + 1,
      }));
    }

    // Check on VCS things
    const { activeWorkspace, activeProject, activeGitRepository } = this.props;
    const changingWorkspace = prevProps.activeWorkspace?._id !== activeWorkspace?._id;

    // Update VCS if needed
    if (changingWorkspace) {
      this._updateVCS();
    }

    // Update Git VCS if needed
    const changingProject = prevProps.activeProject?._id !== activeProject?._id;
    const changingGit = prevProps.activeGitRepository?._id !== activeGitRepository?._id;

    if (changingWorkspace || changingProject || changingGit) {
      this._updateGitVCS();
    }
  }

  async _updateGitVCS() {
    const { activeGitRepository, activeWorkspace, activeProject } = this.props;

    // Get the vcs and set it to null in the state while we update it
    let gitVCS = this.state.gitVCS;
    this.setState({
      gitVCS: null,
    });

    if (!gitVCS) {
      gitVCS = new GitVCS();
    }

    if (activeWorkspace && activeGitRepository) {
      // Create FS client
      const baseDir = path.join(
        getDataDirectory(),
        `version-control/git/${activeGitRepository._id}`,
      );

      /** All app data is stored within a namespaced GIT_INSOMNIA_DIR directory at the root of the repository and is read/written from the local NeDB database */
      const neDbClient = NeDBClient.createClient(activeWorkspace._id, activeProject._id);

      /** All git metadata in the GIT_INTERNAL_DIR directory is stored in a git/ directory on the filesystem */
      const gitDataClient = fsClient(baseDir);

      /** All data outside the directories listed below will be stored in an 'other' directory. This is so we can support files that exist outside the ones the app is specifically in charge of. */
      const otherDatClient = fsClient(path.join(baseDir, 'other'));

      /** The routable FS client directs isomorphic-git to read/write from the database or from the correct directory on the file system while performing git operations. */
      const routableFS = routableFSClient(otherDatClient, {
        [GIT_INSOMNIA_DIR]: neDbClient,
        [GIT_INTERNAL_DIR]: gitDataClient,
      });
      // Init VCS
      const { credentials, uri } = activeGitRepository;

      if (activeGitRepository.needsFullClone) {
        await models.gitRepository.update(activeGitRepository, {
          needsFullClone: false,
        });
        await gitVCS.initFromClone({
          url: uri,
          gitCredentials: credentials,
          directory: GIT_CLONE_DIR,
          fs: routableFS,
          gitDirectory: GIT_INTERNAL_DIR,
        });
      } else {
        await gitVCS.init({
          directory: GIT_CLONE_DIR,
          fs: routableFS,
          gitDirectory: GIT_INTERNAL_DIR,
        });
      }

      // Configure basic info
      const { author, uri: gitUri } = activeGitRepository;
      await gitVCS.setAuthor(author.name, author.email);
      await gitVCS.addRemote(gitUri);
    } else {
      // Create new one to un-initialize it
      gitVCS = new GitVCS();
    }

    this.setState({
      gitVCS,
    });
  }

  async _updateVCS() {
    const { activeWorkspace } = this.props;

    const lock = generateId();
    this._updateVCSLock = lock;

    // Get the vcs and set it to null in the state while we update it
    let vcs = this.state.vcs;
    this.setState({
      vcs: null,
    });

    if (!vcs) {
      const driver = FileSystemDriver.create(getDataDirectory());

      vcs = new VCS(driver, async conflicts => {
        return new Promise(resolve => {
          showModal(SyncMergeModal, {
            conflicts,
            handleDone: (conflicts: MergeConflict[]) => resolve(conflicts),
          });
        });
      });
    }

    if (activeWorkspace) {
      await vcs.switchProject(activeWorkspace._id);
    } else {
      vcs.clearBackendProject();
    }

    // Prevent a potential race-condition when _updateVCS() gets called for different workspaces in rapid succession
    if (this._updateVCSLock === lock) {
      this.setState({
        vcs,
      });
    }
  }

  async _handleDbChange(changes: ChangeBufferEvent[]) {
    let needsRefresh = false;

    for (const change of changes) {
      const [type, doc, fromSync] = change;
      const { vcs } = this.state;
      const { activeRequest } = this.props;

      // Force refresh if environment changes
      // TODO: Only do this for environments in this workspace (not easy because they're nested)
      if (isEnvironment(doc)) {
        console.log('[App] Forcing update from environment change', change);
        needsRefresh = true;
      }

      // Force refresh if sync changes the active request
      if (fromSync && activeRequest && doc._id === activeRequest._id) {
        needsRefresh = true;
        console.log('[App] Forcing update from request change', change);
      }

      // Delete VCS project if workspace deleted
      if (vcs && isWorkspace(doc) && type === db.CHANGE_REMOVE) {
        await vcs.removeBackendProjectsForRoot(doc._id);
      }
    }

    if (needsRefresh) {
      setTimeout(() => {
        this._wrapper?._forceRequestPaneRefresh();
      }, 300);
    }
  }

  async componentDidMount() {
    // Bind mouse and key handlers
    document.addEventListener('mouseup', this._handleMouseUp);
    document.addEventListener('mousemove', this._handleMouseMove);

    this._setGlobalKeyMap();

    // Update title
    this._updateDocumentTitle();

    // Update VCS
    await this._updateVCS();
    await this._updateGitVCS();
    db.onChange(this._handleDbChange);
    ipcRenderer.on('toggle-preferences', () => {
      App._handleShowSettingsModal();
    });

    if (isDevelopment()) {
      ipcRenderer.on('clear-model', () => {
        const options = models
          .types()
          .filter(t => t !== models.settings.type) // don't clear settings
          .map(t => ({ name: t, value: t }));

        showSelectModal({
          title: 'Clear a model',
          message: 'Select a model to clear; this operation cannot be undone.',
          value: options[0].value,
          options,
          onDone: async type => {
            if (type) {
              const bufferId = await db.bufferChanges();
              console.log(`[developer] clearing all "${type}" entities`);
              const allEntities = await db.all(type);
              const filteredEntites = allEntities
                .filter(isNotDefaultProject); // don't clear the default project
              await db.batchModifyDocs({ remove: filteredEntites });
              db.flushChanges(bufferId);
            }
          },
        });
      });

      ipcRenderer.on('clear-all-models', () => {
        showModal(AskModal, {
          title: 'Clear all models',
          message: 'Are you sure you want to clear all models? This operation cannot be undone.',
          yesText: 'Yes',
          noText: 'No',
          onDone: async (yes: boolean) => {
            if (yes) {
              const bufferId = await db.bufferChanges();
              const promises = models
                .types()
                .filter(t => t !== models.settings.type) // don't clear settings
                .reverse().map(async type => {
                  console.log(`[developer] clearing all "${type}" entities`);
                  const allEntities = await db.all(type);
                  const filteredEntites = allEntities
                    .filter(isNotDefaultProject); // don't clear the default project
                  await db.batchModifyDocs({ remove: filteredEntites });
                });
              await Promise.all(promises);
              db.flushChanges(bufferId);
            }
          },
        });
      });
    }

    ipcRenderer.on('reload-plugins', this._handleReloadPlugins);
    ipcRenderer.on('toggle-preferences-shortcuts', () => {
      App._handleShowSettingsModal(TAB_INDEX_SHORTCUTS);
    });
    ipcRenderer.on('run-command', (_, commandUri) => {
      const parsed = urlParse(commandUri, true);
      const command = `${parsed.hostname}${parsed.pathname}`;
      const args = JSON.parse(JSON.stringify(parsed.query));
      args.workspaceId = args.workspaceId || this.props.activeWorkspace?._id;
      this.props.handleCommand(command, args);
    });
    // NOTE: This is required for "drop" event to trigger.
    document.addEventListener(
      'dragover',
      event => {
        event.preventDefault();
      },
      false,
    );
    document.addEventListener(
      'drop',
      async event => {
        event.preventDefault();
        const { activeWorkspace, handleImportUri } = this.props;

        if (!activeWorkspace) {
          return;
        }

        // @ts-expect-error -- TSCONVERSION
        if (event.dataTransfer.files.length === 0) {
          console.log('[drag] Ignored drop event because no files present');
          return;
        }

        // @ts-expect-error -- TSCONVERSION
        const file = event.dataTransfer.files[0];
        const { path } = file;
        const uri = `file://${path}`;
        await showAlert({
          title: 'Confirm Data Import',
          message: (
            <span>
              Import <code>{path}</code>?
            </span>
          ),
          addCancel: true,
        });
        handleImportUri(uri, { workspaceId: activeWorkspace?._id });
      },
      false,
    );
    ipcRenderer.on('toggle-sidebar', this._handleToggleSidebar);

    // Give it a bit before letting the backend know it's ready
    setTimeout(() => ipcRenderer.send('window-ready'), 500);
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addListener(async () => themes.applyColorScheme(this.props.settings));
  }

  componentWillUnmount() {
    // Remove mouse and key handlers
    document.removeEventListener('mouseup', this._handleMouseUp);
    document.removeEventListener('mousemove', this._handleMouseMove);
    db.offChange(this._handleDbChange);
  }

  async _ensureWorkspaceChildren() {
    const {
      activeWorkspace,
      activeWorkspaceMeta,
      activeCookieJar,
      environments,
      activeApiSpec,
    } = this.props;

    if (!activeWorkspace) {
      return;
    }

    const baseEnvironments = environments.filter(environment => environment.parentId === activeWorkspace._id);

    // Nothing to do
    if (baseEnvironments.length && activeCookieJar && activeApiSpec && activeWorkspaceMeta) {
      return;
    }

    // We already started migrating. Let it finish.
    if (this.state.isMigratingChildren) {
      return;
    }

    // Prevent rendering of everything
    this.setState(
      {
        isMigratingChildren: true,
      },
      async () => {
        const flushId = await db.bufferChanges();
        await models.workspace.ensureChildren(activeWorkspace);
        await db.flushChanges(flushId);
        this.setState({
          isMigratingChildren: false,
        });
      },
    );
  }

  // eslint-disable-next-line camelcase
  UNSAFE_componentWillReceiveProps() {
    this._ensureWorkspaceChildren();
  }

  // eslint-disable-next-line camelcase
  UNSAFE_componentWillMount() {
    this._ensureWorkspaceChildren();
  }

  render() {
    if (this.state.isMigratingChildren) {
      console.log('[app] Waiting for migration to complete');
      return null;
    }

    if (!this.props.isFinishedBooting) {
      console.log('[app] Waiting to finish booting');
      return null;
    }

    const { activeWorkspace } = this.props;
    const {
      paneWidth,
      paneHeight,
      sidebarWidth,
      gitVCS,
      vcs,
      forceRefreshCounter,
      forceRefreshHeaderCounter,
    } = this.state;
    const uniquenessKey = `${forceRefreshCounter}::${activeWorkspace?._id || 'n/a'}`;
    return (
      <KeydownBinder onKeydown={this._handleKeyDown}>
        <GrpcProvider>
          <NunjucksEnabledProvider>
            <AppHooks />

            <div className="app" key={uniquenessKey}>
              <ErrorBoundary showAlert>
                <Wrapper
                  ref={this._setWrapperRef}
                  {...this.props}
                  paneWidth={paneWidth}
                  paneHeight={paneHeight}
                  sidebarWidth={sidebarWidth}
                  handleSetRequestPinned={this._handleSetRequestPinned}
                  handleSetRequestGroupCollapsed={this._handleSetRequestGroupCollapsed}
                  handleActivateRequest={this._handleSetActiveRequest}
                  requestPaneRef={this._requestPaneRef}
                  responsePaneRef={this._responsePaneRef}
                  sidebarRef={this._sidebarRef}
                  handleStartDragSidebar={this._startDragSidebar}
                  handleResetDragSidebar={this._resetDragSidebar}
                  handleStartDragPaneHorizontal={this._startDragPaneHorizontal}
                  handleStartDragPaneVertical={this._startDragPaneVertical}
                  handleResetDragPaneHorizontal={this._resetDragPaneHorizontal}
                  handleResetDragPaneVertical={this._resetDragPaneVertical}
                  handleDuplicateRequest={this._requestDuplicate}
                  handleDuplicateRequestGroup={App._requestGroupDuplicate}
                  handleGenerateCode={App._handleGenerateCode}
                  handleGenerateCodeForActiveRequest={this._handleGenerateCodeForActiveRequest}
                  handleCopyAsCurl={this._handleCopyAsCurl}
                  handleSetResponsePreviewMode={this._handleSetResponsePreviewMode}
                  handleSetResponseFilter={this._handleSetResponseFilter}
                  handleSendRequestWithEnvironment={this._handleSendRequestWithEnvironment}
                  handleSendAndDownloadRequestWithEnvironment={
                    this._handleSendAndDownloadRequestWithEnvironment
                  }
                  handleSetActiveResponse={this._handleSetActiveResponse}
                  handleSetActiveEnvironment={this._handleSetActiveEnvironment}
                  handleSetSidebarFilter={this._handleSetSidebarFilter}
                  handleUpdateRequestMimeType={this._handleUpdateRequestMimeType}
                  handleShowSettingsModal={App._handleShowSettingsModal}
                  handleUpdateDownloadPath={this._handleUpdateDownloadPath}
                  headerEditorKey={forceRefreshHeaderCounter + ''}
                  handleSidebarSort={this._sortSidebar}
                  vcs={vcs}
                  gitVCS={gitVCS}
                />
              </ErrorBoundary>

              <ErrorBoundary showAlert>
                <Toast />
              </ErrorBoundary>

              {/* Block all mouse activity by showing an overlay while dragging */}
              {this.state.showDragOverlay ? <div className="blocker-overlay" /> : null}
            </div>
          </NunjucksEnabledProvider>
        </GrpcProvider>
      </KeydownBinder>
    );
  }
}

const mapStateToProps = (state: RootState) => ({
  activeActivity: selectActiveActivity(state),
  activeProject: selectActiveProject(state),
  activeApiSpec: selectActiveApiSpec(state),
  activeWorkspaceName: selectActiveWorkspaceName(state),
  activeCookieJar: selectActiveCookieJar(state),
  activeEnvironment: selectActiveEnvironment(state),
  activeGitRepository: selectActiveGitRepository(state),
  activeRequest: selectActiveRequest(state),
  activeRequestResponses: selectActiveRequestResponses(state),
  activeResponse: selectActiveResponse(state),
  activeUnitTestResult: selectActiveUnitTestResult(state),
  activeUnitTestSuite: selectActiveUnitTestSuite(state),
  activeUnitTestSuites: selectActiveUnitTestSuites(state),
  activeUnitTests: selectActiveUnitTests(state),
  activeWorkspace: selectActiveWorkspace(state),
  activeWorkspaceClientCertificates: selectActiveWorkspaceClientCertificates(state),
  activeWorkspaceMeta: selectActiveWorkspaceMeta(state),
  apiSpecs: selectApiSpecs(state),
  environments: selectEnvironments(state),
  gitRepositories: selectGitRepositories(state),
  isLoading: selectIsLoading(state),
  isLoggedIn: selectIsLoggedIn(state),
  isFinishedBooting: selectIsFinishedBooting(state),
  loadStartTime: selectLoadStartTime(state),
  paneHeight: selectPaneHeight(state),
  paneWidth: selectPaneWidth(state),
  requestGroups: selectRequestGroups(state),
  requestMetas: selectRequestMetas(state),
  requestVersions: selectRequestVersions(state),
  requests: selectRequests(state),
  responseDownloadPath: selectResponseDownloadPath(state),
  responseFilter: selectResponseFilter(state),
  responseFilterHistory: selectResponseFilterHistory(state),
  responsePreviewMode: selectResponsePreviewMode(state),
  settings: selectSettings(state),
  sidebarChildren: selectSidebarChildren(state),
  sidebarFilter: selectSidebarFilter(state),
  sidebarHidden: selectSidebarHidden(state),
  sidebarWidth: selectSidebarWidth(state),
  stats: selectStats(state),
  syncItems: selectSyncItems(state),
  unseenWorkspaces: selectUnseenWorkspaces(state),
  workspacesForActiveProject: selectWorkspacesForActiveProject(state),
  workspaceMetas: selectWorkspaceMetas(state),
});

const mapDispatchToProps = (dispatch: Dispatch<Action<any>>) => {
  const {
    importUri: handleImportUri,
    loadRequestStart: handleStartLoading,
    loadRequestStop: handleStopLoading,
    newCommand: handleCommand,
    setActiveActivity: handleSetActiveActivity,
    activateWorkspace: handleActivateWorkspace,
    exportRequestsToFile: handleExportRequestsToFile,
    initialize: handleInitializeEntities,
  } = bindActionCreators({
    importUri,
    loadRequestStart,
    loadRequestStop,
    newCommand,
    setActiveActivity,
    activateWorkspace,
    exportRequestsToFile,
    initialize,
  }, dispatch);
  return {
    handleCommand,
    handleImportUri,
    handleSetActiveActivity,
    handleActivateWorkspace,
    handleStartLoading,
    handleStopLoading,
    handleExportRequestsToFile,
    handleInitializeEntities,
  };
};

export default connect(mapStateToProps, mapDispatchToProps)(withDragDropContext(App));
