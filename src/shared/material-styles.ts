/** Shared translucent charcoal surfaces with static backdrop blur. */
export const materialStyles = `
  .glass-surface{
    background-color:var(--glass-fill,rgb(24 24 27 / 82%));
    background-image:linear-gradient(135deg,rgb(255 255 255 / 6%),transparent 65%);
    -webkit-backdrop-filter:blur(2px);
    backdrop-filter:blur(2px);
    box-shadow:inset 0 1px 0 rgb(255 255 255 / 18%),inset 0 0 0 1px rgb(255 255 255 / 9%),0 12px 32px rgb(0 0 0 / 22%);
  }
  @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
    .glass-surface{background-color:#252527;background-image:none}
  }
  @media(prefers-reduced-transparency:reduce),(prefers-contrast:more){
    .glass-surface{background-color:#252527;background-image:none;-webkit-backdrop-filter:none;backdrop-filter:none}
  }
`;
