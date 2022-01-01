// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as React from 'react';
import { connect } from 'react-redux';
import { ContentPanel, IContentPanelProps } from '../common/contentPanel';
import { ErrorBoundary } from '../common/errorBoundary';
import { Progress } from '../common/progress';
import { IStore } from '../common/redux/store';
import { ICellViewModel, IMainState } from '../common/types';
import { getConnectedContextualCell } from './contextualCell';
import './contextualPanel.less';
import { actionCreators } from './redux/actions';

type IContextualPanelProps = IMainState & typeof actionCreators;

function mapStateToProps(state: IStore): IMainState {
    return { ...state.main };
}

const ConnectedContextualCell = getConnectedContextualCell();

export class ContextualPanel extends React.Component<IContextualPanelProps> {
    private renderCount: number = 0;
    private mainPanelToolbarRef: React.RefObject<HTMLDivElement> = React.createRef();

    public componentDidMount() {
        window.addEventListener('resize', () => this.forceUpdate(), true);
        this.props.editorLoaded();
    }

    public componentWillUnmount() {
        window.removeEventListener('resize', () => this.forceUpdate());
        this.props.editorUnmounted();
    }

    public render() {
        const dynamicFont: React.CSSProperties = {
            fontSize: this.props.font.size,
            fontFamily: this.props.font.family
        };

        // If in test mode, update our count. Use this to determine how many renders a normal update takes.
        if (this.props.testMode) {
            this.renderCount = this.renderCount + 1;
        }

        // If we're hiding the UI, just render the empty string
        if (this.props.hideUI) {
            return (
                <div id="main-panel" className="native-editor-celltoolbar-middle">
                    <div className="styleSetter">
                        <style>{`${this.props.rootCss ? this.props.rootCss : ''}`}</style>
                    </div>
                    <label className="inputLabel">
                                {'Select a notebook to get contextual help.'}
                    </label>
                </div>
            );
        }
        // Update the state controller with our new state
        const progressBar = (this.props.busy || !this.props.loaded) && !this.props.testMode ? <Progress /> : undefined;
        return (
            <div id="main-panel" role="Main" style={dynamicFont}>
                <div className="styleSetter">
                    <style>{`${this.props.rootCss ? this.props.rootCss : ''}`}</style>
                </div>
                <header ref={this.mainPanelToolbarRef} id="main-panel-toolbar">
                    {progressBar}
                </header>
                <main id="main-panel-content">
                    {this.renderContentPanel(this.props.baseTheme)}
                </main>
            </div>
        );
    }

    private renderContentPanel(baseTheme: string) {
        const contentProps = this.getContentProps(baseTheme);
        return <ContentPanel {...contentProps} />;
    }

    private getContentProps = (baseTheme: string): IContentPanelProps => {
        return {
            baseTheme: baseTheme,
            cellVMs: this.props.cellVMs,
            testMode: this.props.testMode,
            codeTheme: this.props.codeTheme,
            submittedText: this.props.submittedText,
            skipNextScroll: this.props.skipNextScroll ? true : false,
            editable: true,
            renderCell: this.renderCell,
            scrollToBottom: this.scrollDiv,
            scrollBeyondLastLine: false
        };
    };

    private renderCell = (cellVM: ICellViewModel): JSX.Element | null => {
        const maxTextSize = 500;

        return (
            <div key={cellVM.cell.id} id={cellVM.cell.id}>
                <ErrorBoundary>
                    <ConnectedContextualCell
                        role="listitem"
                        maxTextSize={maxTextSize}
                        enableScroll={true}
                        testMode={this.props.testMode}
                        cellVM={cellVM}
                        baseTheme={this.props.baseTheme}
                        codeTheme={this.props.codeTheme}
                        monacoTheme={this.props.monacoTheme}
                        lastCell={true}
                        firstCell={true}
                        font={this.props.font}
                        allowUndo={false}
                        language={'python'}
                    />
                </ErrorBoundary>
            </div>
        );
    };

    private scrollDiv = (_div: HTMLDivElement) => {
        // Doing nothing for now. This should be implemented once redux refactor is done.
    };
}

// Main export, return a redux connected editor
export function getConnectedContextualPanel() {
    return connect(mapStateToProps, actionCreators)(ContextualPanel);
}
