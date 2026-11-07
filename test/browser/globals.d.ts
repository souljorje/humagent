export {};
declare global {
  interface Window {
    droppedStateAcknowledgment?: boolean;
    droppedStageAcknowledgment?: boolean;
    originalSetItem: Storage['setItem'];
  }
}
