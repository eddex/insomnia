import classnames from 'classnames';
import React, { FC, forwardRef, ReactNode, useCallback } from 'react';
import { useSelector } from 'react-redux';

import { selectIsLoading } from '../redux/modules/global';
import { selectActiveEnvironment, selectSettings, selectUnseenWorkspaces, selectWorkspacesForActiveProject } from '../redux/selectors';
import { ErrorBoundary } from './error-boundary';
import { Sidebar } from './sidebar/sidebar';
import type { WrapperProps } from './wrapper';

const Pane = forwardRef<HTMLElement, { position: string; children: ReactNode }>(
  function Pane({ children, position }, ref) {
    return (
      <section ref={ref} className={`pane-${position} theme--pane`}>
        {children}
      </section>
    );
  }
);

interface Props {
  wrapperProps: WrapperProps;
  renderPageSidebar?: ReactNode;
  renderPageHeader?: ReactNode;
  renderPageBody?: ReactNode;
  renderPaneOne?: ReactNode;
  renderPaneTwo?: ReactNode;
}

export const PageLayout: FC<Props> = ({
  renderPaneOne,
  renderPaneTwo,
  renderPageBody,
  renderPageHeader,
  renderPageSidebar,
  wrapperProps,
}) => {
  const activeEnvironment = useSelector(selectActiveEnvironment);
  const isLoading = useSelector(selectIsLoading);
  const settings = useSelector(selectSettings);
  const unseenWorkspaces = useSelector(selectUnseenWorkspaces);
  const workspacesForActiveProject = useSelector(selectWorkspacesForActiveProject);

  const {
    handleResetDragSidebar,
    handleStartDragSidebar,
    handleSetActiveEnvironment,
    sidebarRef,
    requestPaneRef,
    responsePaneRef,
    handleStartDragPaneHorizontal,
    handleResetDragPaneHorizontal,
    handleStartDragPaneVertical,
    handleResetDragPaneVertical,
    paneHeight,
    paneWidth,
    sidebarHidden,
    sidebarWidth,
  } = wrapperProps;

  // Special request updaters
  const startDragSidebar = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    handleStartDragSidebar(event);
  }, [handleStartDragSidebar]);

  const realSidebarWidth = sidebarHidden ? 0 : sidebarWidth;
  const gridRows = renderPaneTwo
    ? `auto minmax(0, ${paneHeight}fr) 0 minmax(0, ${1 - paneHeight}fr)`
    : 'auto 1fr';
  const gridColumns =
    `auto ${realSidebarWidth}rem 0 ` +
    `${renderPaneTwo ? `minmax(0, ${paneWidth}fr) 0 minmax(0, ${1 - paneWidth}fr)` : '1fr'}`;
  return (
    <div
      key="wrapper"
      id="wrapper"
      className={classnames('wrapper', {
        'wrapper--vertical': settings.forceVerticalLayout,
      })}
      style={{
        gridTemplateColumns: gridColumns,
        gridTemplateRows: gridRows,
        boxSizing: 'border-box',
        borderTop:
          activeEnvironment &&
            activeEnvironment.color &&
            settings.environmentHighlightColorStyle === 'window-top'
            ? '5px solid ' + activeEnvironment.color
            : undefined,
        borderBottom:
          activeEnvironment &&
            activeEnvironment.color &&
            settings.environmentHighlightColorStyle === 'window-bottom'
            ? '5px solid ' + activeEnvironment.color
            : undefined,
        borderLeft:
          activeEnvironment &&
            activeEnvironment.color &&
            settings.environmentHighlightColorStyle === 'window-left'
            ? '5px solid ' + activeEnvironment.color
            : undefined,
        borderRight:
          activeEnvironment &&
            activeEnvironment.color &&
            settings.environmentHighlightColorStyle === 'window-right'
            ? '5px solid ' + activeEnvironment.color
            : undefined,
      }}
    >
      {renderPageHeader && <ErrorBoundary showAlert>{renderPageHeader}</ErrorBoundary>}

      {renderPageSidebar && (
        <ErrorBoundary showAlert>
          <Sidebar
            ref={sidebarRef}
            activeEnvironment={activeEnvironment}
            environmentHighlightColorStyle={settings.environmentHighlightColorStyle}
            handleSetActiveEnvironment={handleSetActiveEnvironment}
            hidden={sidebarHidden || false}
            hotKeyRegistry={settings.hotKeyRegistry}
            isLoading={isLoading}
            unseenWorkspaces={unseenWorkspaces}
            width={sidebarWidth}
            workspacesForActiveProject={workspacesForActiveProject}
          >
            {renderPageSidebar}
          </Sidebar>

          <div className="drag drag--sidebar">
            <div
              onDoubleClick={handleResetDragSidebar}
              onMouseDown={startDragSidebar}
            />
          </div>
        </ErrorBoundary>
      )}
      {renderPageBody ? (
        <ErrorBoundary showAlert>{renderPageBody}</ErrorBoundary>
      ) : (
        <>
          {renderPaneOne && (
            <ErrorBoundary showAlert>
              <Pane
                position="one"
                ref={requestPaneRef}
              >
                {renderPaneOne}
              </Pane>
            </ErrorBoundary>
          )}
          {renderPaneTwo && (
            <>
              <div className="drag drag--pane-horizontal">
                <div
                  onMouseDown={handleStartDragPaneHorizontal}
                  onDoubleClick={handleResetDragPaneHorizontal}
                />
              </div>

              <div className="drag drag--pane-vertical">
                <div
                  onMouseDown={handleStartDragPaneVertical}
                  onDoubleClick={handleResetDragPaneVertical}
                />
              </div>

              <ErrorBoundary showAlert>
                <Pane
                  position="two"
                  ref={responsePaneRef}
                >
                  {renderPaneTwo}
                </Pane>
              </ErrorBoundary>
            </>
          )}
        </>
      )}
    </div>
  );
};
