export const inputStyles = `
  .feedback-input {
    --ha-field-padding: var(--ha-padding-content);
    display: block;
    box-sizing: border-box;
    min-width: 0;
    width: 100%;
    height: 42px;
    min-height: 42px;
    max-height: 136px;
    border: 0;
    border-radius: var(--ha-radius-field);
    padding: var(--ha-field-padding);
    resize: none;
    background: var(--ha-bg-field);
    box-shadow: var(--ha-shadow-field);
    color: var(--ha-fg);
    font: var(--ha-font-body);
    caret-color: var(--ha-fg-bright);
    scrollbar-color: var(--ha-scrollbar-thumb) transparent;
  }
  .feedback-input::placeholder { color: var(--ha-fg-muted); }
  .feedback-input:focus-visible {
    outline: 1px solid var(--ha-focus-ring-field);
    outline-offset: 1px;
  }
  @media (max-width: 480px) {
    .feedback-input {
      --ha-field-padding: var(--ha-spacing-2-5) var(--ha-spacing-2);
      font-size: calc(var(--ha-unit) * 4);
    }
  }
`;
