// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// Note to editors, if you change this file you have to restart compile-webviews.
// It doesn't reload the config otherwise.
const common = require('./common');
const webpack = require('webpack');
const constants = require('../constants');
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const configFileName = 'tsconfig.ui.json';
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

// Any build on the CI is considered production mode.
const isProdBuild = constants.isCI || process.argv.includes('--mode');
const fasterCompiler = !!process.env.CI_JUPYTER_FAST_COMPILATION;

function getEntry(bundle) {
    switch (bundle) {
        case 'viewers':
            return {
                contextualHelp: ['babel-polyfill', `./src/ui/contextual-help/index.tsx`]
            };
        throw new Error(`Bundle not supported ${bundle}`);
    }
}

function getPlugins(bundle) {
    const plugins = [];
    // Add the Fork TS type checker only if we need a fast compilation.
    // When running tests, we'll ignore type checking (faster).
    // Other CI jobs can look for ts issues.
    if (!fasterCompiler) {
        new ForkTsCheckerWebpackPlugin({
            typescript: {
                configFile: configFileName,
                reportFiles: ['src/ui/**/*.{ts,tsx}'],
                memoryLimit: 9096
            }
        });
    }
    if (isProdBuild) {
        plugins.push(...common.getDefaultPlugins(bundle));
    }
    const definePlugin = new webpack.DefinePlugin({
        'process.env': {
            NODE_ENV: JSON.stringify('production')
        }
    });
    switch (bundle) {
        case 'viewers': {
            plugins.push(
                ...(isProdBuild ? [definePlugin] : []),
            );
            break;
        }
        default:
            throw new Error(`Bundle not supported ${bundle}`);
    }

    return plugins;
}

function buildConfiguration(bundle) {
    // console.error(`Bundle = ${ bundle }`);
    // Folder inside `datascience-ui` that will be created and where the files will be dumped.
    const bundleFolder = bundle;
    let outputProps = {};
    return {
        context: constants.ExtensionRootDir,
        entry: getEntry(bundle),
        output: {
            path: path.join(constants.ExtensionRootDir, 'dist', 'ui', bundleFolder),
            filename: '[name].js',
            chunkFilename: `[name].bundle.js`,
            pathinfo: false,
            ...outputProps
        },
        mode: isProdBuild ? 'production' : 'development', // Leave as is, we'll need to see stack traces when there are errors.
        devtool: isProdBuild ? undefined : 'inline-source-map',
        optimization: undefined,
        plugins: [
            new webpack.optimize.LimitChunkCountPlugin({
                maxChunks: 100
            }),
            ...getPlugins(bundle)
        ],
        externals: ['log4js'],
        resolve: {
            // Add '.ts' and '.tsx' as resolvable extensions.
            extensions: ['.ts', '.tsx', '.js', '.json', '.svg'],
            fallback: { "path": require.resolve("path-browserify") }
        },

        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: [
                        { loader: 'cache-loader' },
                        {
                            loader: 'thread-loader',
                            options: {
                                // there should be 1 cpu for the fork-ts-checker-webpack-plugin
                                workers: require('os').cpus().length - 1,
                                workerNodeArgs: ['--max-old-space-size=9096'],
                                poolTimeout: isProdBuild ? 1000 : Infinity // set this to Infinity in watch mode - see https://github.com/webpack-contrib/thread-loader
                            }
                        },
                        {
                            loader: 'ts-loader',
                            options: {
                                happyPackMode: true, // IMPORTANT! use happyPackMode mode to speed-up compilation and reduce errors reported to webpack
                                configFile: configFileName,
                                // Faster (turn on only on CI, for dev we don't need this).
                                transpileOnly: true,
                                silent: true,
                                compilerOptions: {
                                    skipLibCheck: true
                                },
                                reportFiles: ['src/ui/**/*.{ts,tsx}']
                            }
                        }
                    ]
                },
                {
                    test: /\.svg$/,
                    use: ['cache-loader', 'thread-loader', 'svg-inline-loader']
                },
                {
                    test: /\.css$/,
                    use: ['cache-loader', 'thread-loader', 'style-loader', 'css-loader']
                },
                {
                    test: /\.js$/,
                    include: /node_modules.*remark.*default.*js/,
                    use: [
                        'cache-loader',
                        'thread-loader',
                        {
                            loader: path.resolve('./build/webpack/loaders/remarkLoader.js'),
                            options: {}
                        }
                    ]
                },
                {
                    test: /\.json$/,
                    type: 'javascript/auto',
                    include: /node_modules.*remark.*/,
                    use: [
                        'cache-loader',
                        'thread-loader',
                        {
                            loader: path.resolve('./build/webpack/loaders/jsonloader.js'),
                            options: {}
                        }
                    ]
                },
                {
                    test: /\.(png|woff|woff2|eot|gif|ttf)$/,
                    use: [
                        'cache-loader',
                        'thread-loader',
                        {
                            loader: 'url-loader?limit=100000',
                            options: { esModule: false }
                        }
                    ]
                },
                {
                    test: /\.less$/,
                    use: ['cache-loader', 'thread-loader', 'style-loader', 'css-loader', 'less-loader']
                }
            ]
        }
    };
}

// tslint:disable-next-line:no-default-export
exports.default = buildConfiguration('viewers');
