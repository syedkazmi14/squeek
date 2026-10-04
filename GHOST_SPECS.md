# Cursor Ghost Specifications

## Visual Design

### Body
- **Shape**: Round, blob-like form with smooth, fluid curves
- **Color**: Bright yellow (#FFD700 or similar)
- **Texture**: Soft, organic, slightly translucent appearance
- **Size**: Medium (approximately 80-100px diameter)
- **Dynamics**: Constantly jiggles and wiggles with organic motion

### Eyes
- **Count**: 2 (one on each side)
- **Shape**: Large, round black dots
- **Behavior**: Follow the mouse cursor position independently
- **Secondary behavior**: Eyes also respond to the ghost's own movement and velocity
- **Tracking**: Smooth, liquid-like eye movement that lags slightly behind the cursor

### Tail
- **Style**: Pointed/tapered extension from the bottom of the body
- **Direction**: Always points AWAY from the body (opposite direction of movement or center)
- **Animation**: Trails and flows with physics, bounces/jiggles
- **Length**: Proportional to ghost size
- **Opacity**: Slightly transparent

## Physics & Animation

### Jiggle Physics
- Body oscillates with subtle, organic wobble
- Movement should feel "alive" and bouncy
- Multiple layers of sine/cosine waves at different frequencies for natural appearance
- Amplitude should be noticeable but not jarring

### Cursor Following
- Ghost follows mouse cursor with smooth easing
- Movement feels floaty and weightless
- No sudden jumps or snapping

### Movement Response
- Eyes track cursor with slight delay (liquid-like motion)
- Tail responds to velocity and direction changes
- Ghost limbs deform slightly when accelerating

## Overall Feel
- Playful and cute
- Fluid and organic, like a living blob
- Responsive to cursor movement
- Energetic but not chaotic
