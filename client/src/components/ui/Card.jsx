import React from 'react';

const Card = ({ children, className = '', noPadding = false, hoverEffect = false, ...props }) => {
    return (
        <div
            className={`
        bg-surface border border-border rounded-xl overflow-hidden
        ${hoverEffect ? 'transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5' : ''}
        ${noPadding ? '' : 'p-6'}
        ${className}
      `}
            {...props}
        >
            {children}
        </div>
    );
};

export default Card;
