import { useState } from 'react';

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'photo' | 'green';
}

const SIZE_CLASSES = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-10 h-10 text-base',
};

export function Avatar({ name, src, size = 'md', variant = 'photo' }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  const sizeClass = SIZE_CLASSES[size];

  if (src && !imgFailed && variant === 'photo') {
    return (
      <img
        src={src}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className={`${sizeClass} rounded-full object-cover shrink-0 bg-[#E5E7EB]`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full shrink-0 flex items-center justify-center font-semibold text-white ${
        variant === 'green' ? 'bg-[#08A842]' : 'bg-[#08A842]'
      }`}
    >
      {initial}
    </div>
  );
}
