import assert from "node:assert/strict";
import test from "node:test";
import { pinScrollTop, shouldPinOpenedChat, shouldLoadEarlierMessages, transcriptScrollAction, visibleTranscriptMessages, hiddenTranscriptMessageCount } from "../lib/chat-scroll";

test("pinScrollTop lands on the last visible page", () => {
  assert.equal(pinScrollTop(2000, 600), 1400);
  assert.equal(pinScrollTop(400, 600), 0);
});

test("opening a chat still pins even if a stray pointer marks user scroll", () => {
  assert.equal(shouldPinOpenedChat({
    enteringChat: true,
    userDetached: false,
    userScrollInput: true,
    stickToBottom: true,
  }), true);
  assert.equal(shouldPinOpenedChat({
    enteringChat: false,
    userDetached: false,
    userScrollInput: true,
    stickToBottom: true,
  }), false);
});

test("layout growth after open re-pins instead of treating the top as a user detach", () => {
  assert.equal(transcriptScrollAction({
    enteringChat: false,
    userScrollInput: false,
    userDetached: false,
    scrolledUp: false,
    scrolledDown: false,
    atBottom: false,
    nearBottom: false,
    layoutResetToTop: false,
    stickToBottom: true,
  }), "pin");
  assert.equal(transcriptScrollAction({
    enteringChat: true,
    userScrollInput: false,
    userDetached: false,
    scrolledUp: false,
    scrolledDown: false,
    atBottom: false,
    nearBottom: false,
    layoutResetToTop: false,
    stickToBottom: false,
  }), "pin");
  assert.equal(transcriptScrollAction({
    enteringChat: false,
    userScrollInput: true,
    userDetached: false,
    scrolledUp: true,
    scrolledDown: false,
    atBottom: false,
    nearBottom: false,
    layoutResetToTop: false,
    stickToBottom: true,
  }), "detach");
});

test("pinned transcripts keep only the newest page in the DOM", () => {
  const messages = Array.from({ length: 80 }, (_, index) => index);
  assert.deepEqual(visibleTranscriptMessages(messages, true), messages.slice(-40));
  assert.equal(visibleTranscriptMessages(messages, false), messages);
  assert.equal(visibleTranscriptMessages(messages.slice(-10), true).length, 10);
  assert.equal(hiddenTranscriptMessageCount(80, 40), 40);
});

const olderPage = { scrollTop: 0, hasEarlierMessages: true, loading: false, enteringChat: false, userDetached: true };

test("older pages load at the top even when another upward input cannot change scrollTop", () => {
  assert.equal(shouldLoadEarlierMessages(olderPage), true);
  assert.equal(shouldLoadEarlierMessages({ ...olderPage, scrollTop: 79 }), true);
  assert.equal(shouldLoadEarlierMessages({ ...olderPage, scrollTop: 80 }), false);
});

test("detached reading loads pages even when the pinning action is ignore", () => {
  assert.equal(transcriptScrollAction({ enteringChat: false, userScrollInput: true, userDetached: true, scrolledUp: false, scrolledDown: false, atBottom: false, nearBottom: false, layoutResetToTop: false, stickToBottom: false }), "ignore");
  assert.equal(shouldLoadEarlierMessages(olderPage), true);
});

test("older pages do not load during chat opening, a pending request, or at the end of history", () => {
  assert.equal(shouldLoadEarlierMessages({ ...olderPage, enteringChat: true }), false);
  assert.equal(shouldLoadEarlierMessages({ ...olderPage, loading: true }), false);
  assert.equal(shouldLoadEarlierMessages({ ...olderPage, hasEarlierMessages: false }), false);
  assert.equal(shouldLoadEarlierMessages({ ...olderPage, userDetached: false }), false);
});
