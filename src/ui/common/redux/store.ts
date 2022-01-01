// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as fastDeepEqual from 'fast-deep-equal';
import { getDefaultSettings } from 'http2';
import * as path from 'path';
import * as Redux from 'redux';
import { createLogger } from 'redux-logger';
import { Identifiers, EXTENSION_ROOT_DIR } from '../../../constants';
import { CssMessages, WindowMessages } from '../../../messages';
import { PostOffice } from '../postOffice';
import { IMainState, CellState, ICellViewModel } from '../types';
import { postActionToExtension, isAllowedAction, isAllowedMessage } from './helpers';
import { generatePostOfficeSendReducer } from './postOffice';
import { CommonActionType } from './reducers/types';
import { IVariableState, generateVariableReducer } from './reducers/variables';

// Externally defined function to see if we need to force on test middleware
export declare function forceTestMiddleware(): boolean;

function generateDefaultState(baseTheme: string): IMainState {
    return {
        // eslint-disable-next-line
        baseTheme: baseTheme,
        cellVMs: [],
        busy: true,
        undoStack: [],
        redoStack: [],
        submittedText: false,
        currentExecutionCount: 0,
        debugging: false,
        knownDark: false,
        dirty: false,
        isAtBottom: true,
        font: {
            size: 14,
            family: "Consolas, 'Courier New', monospace"
        },
        codeTheme: Identifiers.GeneratedThemeName,
        focusPending: 0,
        loaded: false,
        isNotebookTrusted: true,
        hideUI: true
    };
}

function generateMainReducer<M>(
    baseTheme: string,
    reducerMap: M
): Redux.Reducer<IMainState, QueuableAction<M>> {
    // First create our default state.
    const defaultState = generateDefaultState(skipDefault, testMode, baseTheme, editable);

    // Then combine that with our map of state change message to reducer
    return combineReducers<IMainState, M>(defaultState, reducerMap);
}

function createTestLogger() {
    const logFileEnv = process.env.VSC_JUPYTER_WEBVIEW_LOG_FILE;
    if (logFileEnv) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const log4js = require('log4js') as typeof import('log4js');
        const logFilePath = path.isAbsolute(logFileEnv) ? logFileEnv : path.join(EXTENSION_ROOT_DIR, logFileEnv);
        log4js.configure({
            appenders: { reduxLogger: { type: 'file', filename: logFilePath } },
            categories: { default: { appenders: ['reduxLogger'], level: 'debug' } }
        });
        return log4js.getLogger();
    }
}

function createTestMiddleware(transformLoad: () => Promise<void>): Redux.Middleware<{}, IStore> {
    // Make sure all dynamic imports are loaded.
    const transformPromise = transformLoad();

    // eslint-disable-next-line complexity
    return (store) => (next) => (action) => {
        const prevState = store.getState();
        const res = next(action);
        const afterState = store.getState();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sendMessage = (message: any, payload?: any) => {
            setTimeout(() => {
                transformPromise
                    .then(() => postActionToExtension({ queueAction: store.dispatch }, message, payload))
            });
        };

        if (action.type !== 'action.postOutgoingMessage') {
            sendMessage(`DISPATCHED_ACTION_${action.type}`, {});
        }
        return res;
    };
}

function createMiddleWare(
    testMode: boolean,
    postOffice: PostOffice,
    transformLoad: () => Promise<void>
): Redux.Middleware<{}, IStore>[] {
    // Create the middleware that modifies actions to queue new actions
    const queueableActions = createQueueableActionMiddleware();

    // Create the test middle ware. It sends messages that are used for testing only
    // Or if testing in UI Test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isUITest = (postOffice.acquireApi() as any)?.handleMessage ? true : false;
    let forceOnTestMiddleware = false;
    if (typeof forceTestMiddleware !== 'undefined') {
        forceOnTestMiddleware = forceTestMiddleware();
    }
    const testMiddleware =
        forceOnTestMiddleware || testMode || isUITest ? createTestMiddleware(transformLoad) : undefined;

    // Create the logger if we're not in production mode or we're forcing logging
    const reduceLogMessage = '<payload too large to displayed in logs (at least on CI)>';
    const actionsWithLargePayload = [
        CssMessages.GetCssResponse,
    ];
    const logger = createLogger({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stateTransformer: (state: any) => {
            if (!state || typeof state !== 'object') {
                return state;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rootState = { ...state } as any;
            if ('main' in rootState && typeof rootState.main === 'object') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const main = (rootState.main = { ...rootState.main } as any as Partial<IMainState>);
                main.rootCss = reduceLogMessage;
                main.rootStyle = reduceLogMessage;
            }
            rootState.monaco = reduceLogMessage;

            return rootState;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        actionTransformer: (action: any) => {
            if (!action) {
                return action;
            }
            if (actionsWithLargePayload.indexOf(action.type) >= 0) {
                return { ...action, payload: reduceLogMessage };
            }
            return action;
        },
        logger: testMode ? createTestLogger() : window.console
    });

    // Environment variables only work in functional tests (browser doesn't have access to env). In order for logging to be present in
    // development, you have to hardcode this
    const loggerMiddleware =
        process.env.VSC_JUPYTER_FORCE_LOGGING !== undefined && !process.env.VSC_JUPYTER_DS_NO_REDUX_LOGGING
            ? logger
            : undefined;
    // logger;

    const results: Redux.Middleware<{}, IStore>[] = [];
    results.push(queueableActions);
    if (testMiddleware) {
        results.push(testMiddleware);
    }
    if (loggerMiddleware) {
        results.push(loggerMiddleware);
    }

    return results;
}

export interface IStore {
    main: IMainState;
    variables: IVariableState;
    monaco: IMonacoState;
    post: {};
}

export interface IMainWithVariables extends IMainState {
    variableState: IVariableState;
}

/**
 * Middleware that will ensure all actions have `messageDirection` property.
 */
const addMessageDirectionMiddleware: Redux.Middleware = (_store) => (next) => (action: Redux.AnyAction) => {
    if (isAllowedAction(action)) {
        // Ensure all dispatched messages have been flagged as `incoming`.
        const payload: BaseReduxActionPayload<{}> = action.payload || {};
        if (!payload.messageDirection) {
            action.payload = { ...payload, messageDirection: 'incoming' };
        }
    }

    return next(action);
};

export function createStore<M>(
    skipDefault: boolean,
    baseTheme: string,
    testMode: boolean,
    editable: boolean,
    showVariablesOnDebug: boolean,
    variablesStartOpen: boolean,
    reducerMap: M,
    postOffice: PostOffice,
    transformLoad: () => Promise<void>
) {
    // Create reducer for the main react UI
    const mainReducer = generateMainReducer(skipDefault, testMode, baseTheme, editable, reducerMap);

    // Create reducer to pass window messages to the other side
    const postOfficeReducer = generatePostOfficeSendReducer(postOffice);

    // Create another reducer for handling monaco state
    const monacoReducer = generateMonacoReducer(testMode, postOffice);

    // Create another reducer for handling variable state
    const variableReducer = generateVariableReducer(showVariablesOnDebug, variablesStartOpen);

    // Combine these together
    const rootReducer = Redux.combineReducers<IStore>({
        main: mainReducer,
        variables: variableReducer,
        monaco: monacoReducer,
        post: postOfficeReducer
    });

    // Create our middleware
    const middleware = createMiddleWare(testMode, postOffice, transformLoad).concat([addMessageDirectionMiddleware]);

    // Use this reducer and middle ware to create a store
    const store = Redux.createStore(rootReducer, Redux.applyMiddleware(...middleware));

    // Make all messages from the post office dispatch to the store, changing the type to
    // turn them into actions.
    postOffice.addHandler({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handleMessage(message: string, payload?: any): boolean {
            // Double check this is one of our messages. React will actually post messages here too during development
            if (isAllowedMessage(message)) {
                const basePayload: BaseReduxActionPayload = { data: payload };
                if (message === InteractiveWindowMessages.Sync) {
                    // This is a message that has been sent from extension purely for synchronization purposes.
                    // Unwrap the message.
                    message = payload.type;
                    // This is a message that came in as a result of an outgoing message from another view.
                    basePayload.messageDirection = 'outgoing';
                    basePayload.messageType = payload.payload.messageType ?? MessageType.syncAcrossSameNotebooks;
                    basePayload.data = payload.payload.data;
                } else {
                    // Messages result of some user action.
                    basePayload.messageType = basePayload.messageType ?? MessageType.other;
                }
                store.dispatch({ type: message, payload: basePayload });
            }
            return true;
        }
    });

    return store;
}