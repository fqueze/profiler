/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import React, { PureComponent } from 'react';
import { MenuItem } from 'react-contextmenu';

import { ContextMenu } from './ContextMenu';
import explicitConnect from 'firefox-profiler/utils/connect';

import {
  setContextMenuVisibility,
  updatePreviewSelection,
} from 'firefox-profiler/actions/profile-view';
import {
  getPreviewSelection,
  getCommittedRange,
} from 'firefox-profiler/selectors/profile';
import { getRightClickedMarkerInfo } from 'firefox-profiler/selectors/right-clicked-marker';
import copy from 'copy-to-clipboard';

import type {
  Marker,
  MarkerIndex,
  StartEndRange,
  PreviewSelection,
  ImplementationFilter,
  IndexIntoStackTable,
  Thread,
  RightClickedMarkerInfo,
} from 'firefox-profiler/types';

import type { ConnectedProps } from 'firefox-profiler/utils/connect';
import { getImplementationFilter } from 'firefox-profiler/selectors/url-state';

import { filterCallNodeAndCategoryPathByImplementation } from 'firefox-profiler/profile-logic/transforms';
import {
  convertStackToCallNodeAndCategoryPath,
  getFuncNamesAndOriginsForPath,
} from 'firefox-profiler/profile-logic/profile-data';
import { getThreadSelectorsFromThreadsKey } from 'firefox-profiler/selectors/per-thread';

import './MarkerContextMenu.css';

type OwnProps = {|
  +rightClickedMarkerInfo: RightClickedMarkerInfo,
|};

type StateProps = {|
  +marker: Marker,
  +markerIndex: MarkerIndex,
  +previewSelection: PreviewSelection,
  +committedRange: StartEndRange,
  +thread: Thread | null,
  +implementationFilter: ImplementationFilter,
  +getMarkerLabelToCopy: MarkerIndex => string,
|};

type DispatchProps = {|
  +updatePreviewSelection: typeof updatePreviewSelection,
  +setContextMenuVisibility: typeof setContextMenuVisibility,
|};

type Props = ConnectedProps<OwnProps, StateProps, DispatchProps>;

class MarkerContextMenuImpl extends PureComponent<Props> {
  _setStartRange = (selectionStart: number) => {
    const {
      updatePreviewSelection,
      previewSelection,
      committedRange,
    } = this.props;

    const selectionEnd = previewSelection.hasSelection
      ? previewSelection.selectionEnd
      : committedRange.end;

    updatePreviewSelection({
      hasSelection: true,
      isModifying: false,
      selectionStart,
      selectionEnd,
    });
  };

  _setEndRange = (selectionEnd: number) => {
    const {
      updatePreviewSelection,
      committedRange,
      previewSelection,
    } = this.props;

    const selectionStart = previewSelection.hasSelection
      ? previewSelection.selectionStart
      : committedRange.start;

    if (selectionEnd === selectionStart) {
      // For InstantMarkers, or Interval markers with 0 duration, add an arbitrarily
      // small bit of time at the end to make sure the selected marker doesn't disappear
      // from view.
      selectionEnd += 0.0001;
    }

    updatePreviewSelection({
      hasSelection: true,
      isModifying: false,
      selectionStart,
      selectionEnd,
    });
  };

  setStartRangeFromMarkerStart = () => {
    const { marker } = this.props;
    this._setStartRange(marker.start);
  };

  setStartRangeFromMarkerEnd = () => {
    const { marker } = this.props;
    this._setStartRange(marker.end || marker.start);
  };

  setEndRangeFromMarkerStart = () => {
    const { marker } = this.props;
    this._setEndRange(marker.start);
  };

  setEndRangeFromMarkerEnd = () => {
    const { marker } = this.props;
    this._setEndRange(marker.end || marker.start);
  };

  setRangeByDuration = () => {
    const { marker, updatePreviewSelection } = this.props;

    if (marker.end === null) {
      return;
    }

    updatePreviewSelection({
      hasSelection: true,
      isModifying: false,
      selectionStart: marker.start,
      selectionEnd: marker.end,
    });
  };

  _isZeroDurationMarker(marker: ?Marker): boolean {
    return !marker || marker.end === null;
  }

  _convertStackToString(stack: IndexIntoStackTable): string {
    const { thread, implementationFilter } = this.props;

    if (thread === null) {
      return '';
    }

    const path = filterCallNodeAndCategoryPathByImplementation(
      thread,
      implementationFilter,
      convertStackToCallNodeAndCategoryPath(thread, stack)
    );

    const funcNamesAndOrigins = getFuncNamesAndOriginsForPath(path, thread);
    return funcNamesAndOrigins
      .map(({ funcName, origin }) => `${funcName} [${origin}]`)
      .join('\n');
  }

  copyMarkerJSON = () => {
    copy(JSON.stringify(this.props.marker, null, 2));
  };

  copyMarkerDescription = () => {
    const { markerIndex, getMarkerLabelToCopy } = this.props;
    copy(getMarkerLabelToCopy(markerIndex));
  };

  copyMarkerCause = () => {
    const { marker } = this.props;

    if (marker.data && marker.data.cause) {
      const stack = this._convertStackToString(marker.data.cause.stack);
      if (stack) {
        copy(stack);
      } else {
        copy(
          'The stack is empty because all of its frames are filtered out by the implementation filter. Switch the implementation filter in the call tree to see more frames.'
        );
      }
    }
  };

  copyUrl = () => {
    const { marker } = this.props;

    if (marker.data && marker.data.type === 'Network') {
      copy(marker.data.URI);
    }
  };

  // Using setTimeout here is a bit complex, but is necessary to make the menu
  // work fine when we want to display it somewhere when it's already open
  // somewhere else.
  // This is the order of events in such a situation:
  // 0. The menu is open somewhere, it means the user right clicked somewhere
  //     previously, and as a result some marker has the "right clicked" status.
  // 1. The user right clicks on another marker. This is actually happening in
  //    several events, the first event is "mousedown": this is where our own
  //    components react for right click (both our TreeView and our charts)
  //    and thus this is when the "right clicked" item is set in our store. BTW
  //    this triggers a rerender of this component.
  // 2. Then the event "mouseup" happens but we don't do anything for it for right
  //    clicks.
  // 3. Then the event "contextmenu" is triggered. This is the event that the
  //    context menu library reacts to: first it closes the previous menu, then
  //    opens the new one. This means that `_onHide` is called first for the
  //    first menu, then `_onShow` for the second menu.
  //    The problem here is that the call to `setContextMenuVisibility` we do in
  //    `onHide` resets the value for the "right clicked" item. This is normally
  //    what we want when the user closes the menu, but in this case where the
  //    menu is still open but for another node, we don't want to reset this
  //    value which was set earlier when handling the "mousedown" event.
  //    To avoid this problem we use this `setTimeout` call to delay the reset
  //    just a bit, just in case we get a `_onShow` call right after that.
  _hidingTimeout: TimeoutID | null = null;

  _onHide = () => {
    this._hidingTimeout = setTimeout(() => {
      this._hidingTimeout = null;
      this.props.setContextMenuVisibility(false);
    });
  };

  _onShow = () => {
    clearTimeout(this._hidingTimeout);
    this.props.setContextMenuVisibility(true);
  };

  render() {
    const { marker, previewSelection, committedRange } = this.props;
    const { data } = marker;

    const selectionEnd = previewSelection.hasSelection
      ? previewSelection.selectionEnd
      : committedRange.end;

    const selectionStart = previewSelection.hasSelection
      ? previewSelection.selectionStart
      : committedRange.start;

    const markerEnd = marker.end || marker.start;

    const markerStart = marker.start;

    return (
      <ContextMenu
        id="MarkerContextMenu"
        className="markerContextMenu"
        onShow={this._onShow}
        onHide={this._onHide}
      >
        <MenuItem
          onClick={this.setRangeByDuration}
          disabled={this._isZeroDurationMarker(marker)}
        >
          <span className="react-contextmenu-icon markerContextMenuIconSetSelectionFromMarker" />
          Set selection from marker’s duration
        </MenuItem>
        <div className="react-contextmenu-separator" />
        {this._isZeroDurationMarker(marker) ? (
          <>
            <MenuItem onClick={this.setStartRangeFromMarkerStart}>
              <span className="react-contextmenu-icon markerContextMenuIconStartSelectionHere" />
              Start selection here
            </MenuItem>
            <MenuItem onClick={this.setEndRangeFromMarkerEnd}>
              <span className="react-contextmenu-icon markerContextMenuIconEndSelectionHere" />
              End selection here
            </MenuItem>
          </>
        ) : (
          <>
            <MenuItem onClick={this.setStartRangeFromMarkerStart}>
              <span className="react-contextmenu-icon markerContextMenuIconStartSelectionAtMarkerStart" />
              <div className="react-contextmenu-item-content">
                Start selection at marker’s <strong>start</strong>
              </div>
            </MenuItem>
            <MenuItem
              onClick={this.setStartRangeFromMarkerEnd}
              disabled={markerEnd > selectionEnd}
            >
              <span className="react-contextmenu-icon markerContextMenuIconStartSelectionAtMarkerEnd" />
              <div className="react-contextmenu-item-content">
                Start selection at marker’s <strong>end</strong>
              </div>
            </MenuItem>
            <div className="react-contextmenu-separator" />
            <MenuItem
              onClick={this.setEndRangeFromMarkerStart}
              disabled={selectionStart > markerStart}
            >
              <span className="react-contextmenu-icon markerContextMenuIconEndSelectionAtMarkerStart" />
              <div className="react-contextmenu-item-content">
                End selection at marker’s <strong>start</strong>
              </div>
            </MenuItem>
            <MenuItem onClick={this.setEndRangeFromMarkerEnd}>
              <span className="react-contextmenu-icon markerContextMenuIconEndSelectionAtMarkerEnd" />
              <div className="react-contextmenu-item-content">
                End selection at marker’s <strong>end</strong>
              </div>
            </MenuItem>
          </>
        )}

        <div className="react-contextmenu-separator" />
        <MenuItem onClick={this.copyMarkerDescription}>
          <span className="react-contextmenu-icon markerContextMenuIconCopyDescription" />
          Copy description
        </MenuItem>
        {data && data.cause ? (
          <MenuItem onClick={this.copyMarkerCause}>
            <span className="react-contextmenu-icon markerContextMenuIconCopyStack" />
            Copy call stack
          </MenuItem>
        ) : null}
        {data && data.type === 'Network' ? (
          <MenuItem onClick={this.copyUrl}>
            <span className="react-contextmenu-icon markerContextMenuIconCopyUrl" />
            Copy URL
          </MenuItem>
        ) : null}
        <MenuItem onClick={this.copyMarkerJSON}>
          <span className="react-contextmenu-icon markerContextMenuIconCopyPayload" />
          Copy full payload
        </MenuItem>
      </ContextMenu>
    );
  }
}

const MarkerContextMenu = explicitConnect<OwnProps, StateProps, DispatchProps>({
  mapStateToProps: (state, ownProps) => {
    const { threadsKey, markerIndex } = ownProps.rightClickedMarkerInfo;

    const selectors = getThreadSelectorsFromThreadsKey(threadsKey);
    const getMarker = selectors.getMarkerGetter(state);

    return {
      markerIndex,
      marker: getMarker(markerIndex),
      previewSelection: getPreviewSelection(state),
      committedRange: getCommittedRange(state),
      implementationFilter: getImplementationFilter(state),
      thread: selectors.getThread(state),
      getMarkerLabelToCopy: selectors.getMarkerLabelToCopyGetter(state),
    };
  },
  mapDispatchToProps: { updatePreviewSelection, setContextMenuVisibility },
  component: MarkerContextMenuImpl,
});

type MaybeProps = {|
  +rightClickedMarkerInfo: RightClickedMarkerInfo | null,
|};

/**
 * This component only renders the context menu if there is a right clicked marker.
 * It is the component that is actually exported here.
 */
class MaybeMarkerContextMenuImpl extends PureComponent<MaybeProps> {
  render() {
    const { rightClickedMarkerInfo } = this.props;

    if (rightClickedMarkerInfo === null) {
      return null;
    }

    return (
      <MarkerContextMenu rightClickedMarkerInfo={rightClickedMarkerInfo} />
    );
  }
}

export const MaybeMarkerContextMenu = explicitConnect<{||}, MaybeProps, {||}>({
  mapStateToProps: state => ({
    rightClickedMarkerInfo: getRightClickedMarkerInfo(state),
  }),
  component: MaybeMarkerContextMenuImpl,
});
