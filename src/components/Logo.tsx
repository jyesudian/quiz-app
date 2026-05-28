import React from 'react';

interface LogoProps {
  className?: string;
  size?: number;
}

export const Logo: React.FC<LogoProps> = ({ className = '', size = 48 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Ambient glow in background */}
      <circle cx="50" cy="50" r="42" fill="url(#logo-glow)" opacity="0.15" />
      
      {/* Light Rays (Knowledge / Illumination / Daat) */}
      <g stroke="url(#gold-gradient)" strokeWidth="2.5" strokeLinecap="round" opacity="0.9">
        <line x1="50" y1="20" x2="50" y2="10" />
        <line x1="32" y1="26" x2="24" y2="18" />
        <line x1="68" y1="26" x2="76" y2="18" />
        <line x1="24" y1="42" x2="14" y2="42" />
        <line x1="76" y1="42" x2="86" y2="42" />
      </g>

      {/* Open Book Pages (Truth / Word of God) */}
      <path
        d="M50 82C35 82 22 72 12 75V35C22 32 35 42 50 42C65 42 78 32 88 35V75C78 72 65 82 50 82Z"
        fill="url(#book-pages-grad)"
        stroke="url(#blue-gradient)"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      
      {/* Book Center Fold / Spine */}
      <path
        d="M50 42V82"
        stroke="url(#blue-gradient)"
        strokeWidth="4"
        strokeLinecap="round"
      />

      {/* Gold Cross (Lord & Savior Jesus Christ) */}
      <path
        d="M48.5 25H51.5V70H48.5V25Z"
        fill="url(#gold-gradient)"
      />
      <path
        d="M38 36H62V39H38V36Z"
        fill="url(#gold-gradient)"
      />

      {/* Sprout & Leaves (Growing in Grace) */}
      <path
        d="M49 60C43 56 41 49 44 44C46 47 48 48 49 52"
        stroke="url(#green-gradient)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M44 44C41 45 39 42 42 39C45 40 45 43 44 44Z"
        fill="url(#green-gradient)"
      />
      
      <path
        d="M51 54C56 51 59 47 56 41C54 44 52 46 51 48"
        stroke="url(#green-gradient)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M56 41C58 43 61 41 59 38C56 38 56 40 56 41Z"
        fill="url(#green-gradient)"
      />

      {/* Gradients definitions */}
      <defs>
        <radialGradient id="logo-glow" cx="50" cy="50" r="45" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gold-gradient" x1="50" y1="10" x2="50" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="50%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
        <linearGradient id="blue-gradient" x1="50" y1="42" x2="50" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#1E3A8A" />
        </linearGradient>
        <linearGradient id="book-pages-grad" x1="50" y1="42" x2="50" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#F1F5F9" />
        </linearGradient>
        <linearGradient id="green-gradient" x1="38" y1="38" x2="62" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>
    </svg>
  );
};
