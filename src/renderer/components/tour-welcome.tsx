import * as React from 'react';

import { Button, Classes, Dialog } from '@blueprintjs/core';
import { observer } from 'mobx-react';

import { TestIdContainer } from './TestIdContainer';
import { Tour, TourScriptStep, TourStepGetButtonParams } from './tour';
import { AppState } from '../state';

interface WelcomeTourProps {
  appState: AppState;
}

interface WelcomeTourState {
  isTourStarted: boolean;
}

/**
 * This is our "Welcome to React Native Fiddle" Tour. It includes both an intro
 * to the app and a short intro to React Native.
 */
export function getWelcomeTour(): Set<TourScriptStep> {
  return new Set([
    {
      name: 'fiddle-editors',
      selector: 'div.mosaic-root',
      title: '📝 Fiddle Editors',
      content: (
        <>
          <p>
            React Native Fiddle allows you to build little experiments and
            mini-apps with React Native. Each Fiddle is likely comprised of an
            entrypoint file (<code>index.js</code>) and a root UI component (
            <code>App.js</code>). There may be some supporting files as well
            (like <code>metro.config.js</code>), but those should probably be
            left alone!
          </p>
          <p>
            If you <code>require()</code> a module, Fiddle will install it
            automatically. It will also automatically provide you with
            autocomplete information for the <code>react-native-macos</code> or{' '}
            <code>react-native-windows</code> module.
          </p>
        </>
      ),
    },
    {
      name: 'select-versions',
      selector: '#version-chooser',
      title: '📇 Choose a React Native Version',
      content: (
        <>
          <p>
            React Native Fiddle knows about all released React Native desktop
            versions, downloading your versions automatically in the background.
          </p>
          <p>
            Open the preferences to see all available versions and delete those
            previously downloaded.
          </p>
        </>
      ),
    },
    {
      name: 'button-run',
      selector: '#button-run',
      title: '🚀 Run Your Fiddle',
      content: (
        <>
          <p>Hit this button to give your Fiddle a try and start it.</p>
          <p>
            When your Fiddle starts, it will create a user data directory for
            cookies, the cache, and a few other things. We delete this directory
            by default when you exit the Fiddle, but you can change this in
            Settings.
          </p>
        </>
      ),
    },
    {
      name: 'button-action',
      selector: '#button-action',
      title: '🗺 Share Your Fiddle',
      content: (
        <>
          <p>
            Like what you&apos;ve built? You can save your Fiddle as a public
            GitHub Gist, allowing other users to load it by pasting the URL into
            the address bar. If they don&apos;t have React Native Fiddle, they
            can see and download your code directly from GitHub.
          </p>
          <p>
            You can also package your Fiddle as a standalone binary or as an
            installer from the &quot;Tasks&quot; menu.
          </p>
        </>
      ),
    },
    {
      name: 'first-time-electron',
      selector: 'div.mosaic-root',
      title: '🏁 Finish',
      // title: '👋 Getting Started With React Native?',
      content: (
        <p>
          We&apos;ve finished our tour of React Native Fiddle!
          {/* But if this is your first time using React Native, we could introduce you to its basics. Interested? */}
        </p>
      ),
      // getButtons: ({
      //   stop,
      //   advance,
      // }: TourStepGetButtonParams): Array<JSX.Element> => {
      //   return [
      //     <Button key="btn-stop" onClick={stop} text="I'm good!" icon="stop" />,
      //     <Button
      //       key="btn-adv"
      //       onClick={advance}
      //       text="React Native Basics"
      //       icon="help"
      //     />,
      //   ];
      // },
    },
    // {
    //   name: 'main-editor',
    //   selector: 'div.mosaic-window.main\\.js',
    //   title: '📝 Main Script',
    //   content: (
    //     <>
    //       <p>
    //         Every Electron app starts with a main script, very similar to how a
    //         Node.js application is started. The main script runs in the
    //         &quot;main process&quot;. To display a user interface, the main
    //         process creates renderer processes – usually in the form of windows,
    //         which Electron calls &nbsp;<code>BrowserWindow</code>.
    //       </p>
    //       <p>
    //         To get started, pretend that the main process is just like a Node.js
    //         process. All APIs and features found in Electron are accessible
    //         through the <code>electron</code> module, which can be required like
    //         any other Node.js module.
    //       </p>
    //       <p>
    //         The default fiddle creates a new <code>BrowserWindow</code> and
    //         loads an HTML file.
    //       </p>
    //     </>
    //   ),
    // },
    // {
    //   name: 'html-editor',
    //   selector: 'div.mosaic-window.index\\.html',
    //   title: '📝 HTML',
    //   content: (
    //     <p>
    //       In the default fiddle, this HTML file is loaded in the &nbsp;
    //       <code>BrowserWindow</code>. Any HTML, CSS, or JavaScript that works in
    //       a browser will work here, too. In addition, Electron allows you to
    //       execute Node.js code. Take a close look at the &nbsp;
    //       <code>&lt;script /&gt;</code> tag and notice how we can call{' '}
    //       <code>require()</code> like we would in Node.js.
    //     </p>
    //   ),
    // },
    // {
    //   name: 'renderer-editor',
    //   selector: 'div.mosaic-window.renderer\\.js',
    //   title: '📝  Renderer Script',
    //   content: (
    //     <>
    //       <p>
    //         This is the script we just required from the HTML file. In here, you
    //         can do anything that works in Node.js <i>and</i> anything that works
    //         in a browser.
    //       </p>
    //       <p>
    //         By the way: If you want to use an <code>npm</code> module here, just
    //         &nbsp;<code>require</code> it. Electron Fiddle will automatically
    //         detect that you requested a module and install it as soon as you run
    //         your fiddle.
    //       </p>
    //     </>
    //   ),
    // },
  ]);
}

/**
 * The "Welcome to Electron Fiddle" Tour.
 */
export const WelcomeTour = observer(
  class WelcomeTour extends React.Component<
    WelcomeTourProps,
    WelcomeTourState
  > {
    constructor(props: WelcomeTourProps) {
      super(props);

      this.stopTour = this.stopTour.bind(this);
      this.startTour = this.startTour.bind(this);

      this.state = {
        isTourStarted: false,
      };
    }

    /**
     * Stops the tour, closing it.
     */
    public stopTour() {
      this.props.appState.disableTour();
    }

    /**
     * Starts the tour.
     */
    public startTour() {
      this.setState({ isTourStarted: true });
    }

    get buttons() {
      return (
        <>
          <Button
            key="cancel"
            onClick={this.stopTour}
            icon="cross"
            text={`I'll figure it out`}
          />
          <Button
            key="ok"
            onClick={this.startTour}
            icon="presentation"
            text="Show me around"
          />
        </>
      );
    }

    public render() {
      const { isTourShowing } = this.props.appState;
      const { isTourStarted } = this.state;

      if (!isTourShowing) return null;

      if (!isTourStarted) {
        return (
          <Dialog key="welcome-tour-dialog" isOpen={true}>
            <TestIdContainer testId="welcome-tour-dialog">
              <div className={Classes.DIALOG_HEADER}>
                <h4 className={Classes.HEADING}>🙋‍ Hey There!</h4>
              </div>
              <div className={Classes.DIALOG_BODY}>
                <p>
                  Welcome to React Native Fiddle! If you&apos;re new to the app,
                  we&apos;d like to give you a brief tour of its features.
                </p>
                <p>
                  We won&apos;t show this dialog again, but you can always find
                  the tour in the Help menu.
                </p>
              </div>
              <div className={Classes.DIALOG_FOOTER}>
                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                  {this.buttons}
                </div>
              </div>
            </TestIdContainer>
          </Dialog>
        );
      } else {
        return <Tour tour={getWelcomeTour()} onStop={this.stopTour} />;
      }
    }
  },
);
