// Static content for the hub. Rename the suite or add apps here.
const BRAND = {
  name: 'Crop Cloud',
  version: '0.2.0',
};

// status: 'available' apps are built and ship in releases; 'planned' apps show on the roadmap.
// entry: path to the app's page. version: bump it when the app changes, so the
// desktop app offers the update.
const APPS = [
  {
    id: 'photocrop', code: 'Pc', name: 'PhotoCrop', status: 'available', version: '0.2.0', entry: 'apps/photocrop/index.html',
    colors: ['#2f6bff', '#00c2ff'], categories: ['photo', 'design'],
    tagline: 'Photo editing and compositing',
    description: 'Layers, masks, crop and retouch with a workflow built around how you actually work.',
  },
  {
    id: 'vectorcrop', code: 'Vc', name: 'VectorCrop', status: 'planned',
    colors: ['#ff7a00', '#ffc23d'], categories: ['illustration', 'design'],
    tagline: 'Vector graphics and illustration',
    description: 'Logos, icons and illustrations that stay sharp at any size.',
  },
  {
    id: 'pagecrop', code: 'Pg', name: 'PageCrop', status: 'planned',
    colors: ['#ff2d6f', '#ff7aa2'], categories: ['design'],
    tagline: 'Layouts for print and PDF',
    description: 'Posters, flyers, magazines and multi-page documents.',
  },
  {
    id: 'framecrop', code: 'Fc', name: 'FrameCrop', status: 'available', version: '0.1.1', entry: 'apps/framecrop/index.html',
    colors: ['#7a3cff', '#c46bff'], categories: ['video'],
    tagline: 'Video editing and color grading',
    description: 'Multi-track editing with node-based color, effects, titles, an audio mixer and MP4 export.',
  },
  {
    id: 'motioncrop', code: 'Mc', name: 'MotionCrop', status: 'planned',
    colors: ['#4b2bff', '#ff4fd8'], categories: ['video'],
    tagline: 'Motion graphics and animation',
    description: 'Animated titles, transitions and keyframed effects.',
  },
  {
    id: 'mockcrop', code: 'Mk', name: 'MockCrop', status: 'planned',
    colors: ['#ff5436', '#ffa04a'], categories: ['ui'],
    tagline: 'UI design and prototyping',
    description: 'Screens, components and clickable prototypes.',
  },
  {
    id: 'pixelcrop', code: 'Px', name: 'PixelCrop', status: 'planned',
    colors: ['#00a86b', '#5be3a6'], categories: ['illustration'],
    tagline: 'Pixel art and sprites',
    description: 'Grid-snapped drawing, palettes and sprite sheet export.',
  },
  {
    id: 'colorcrop', code: 'Co', name: 'ColorCrop', status: 'planned',
    colors: ['#009e9e', '#3fe0cf'], categories: ['design', 'ui'],
    tagline: 'Palettes and color themes',
    description: 'Build, test and share color palettes across every app.',
  },
];

const CATEGORIES = [
  { id: 'photo', label: 'Photo' },
  { id: 'design', label: 'Graphic design' },
  { id: 'illustration', label: 'Illustration' },
  { id: 'video', label: 'Video and motion' },
  { id: 'ui', label: 'UI and UX' },
];

const PRESETS = [
  { id: 'custom', name: 'Custom size', width: 1920, height: 1080, unit: 'px' },
  { id: 'insta-post', name: 'Instagram post', width: 1080, height: 1080, unit: 'px' },
  { id: 'insta-story', name: 'Story', width: 1080, height: 1920, unit: 'px' },
  { id: 'yt-thumb', name: 'YouTube thumbnail', width: 1280, height: 720, unit: 'px' },
  { id: 'hd', name: 'Full HD', width: 1920, height: 1080, unit: 'px' },
  { id: 'a4', name: 'A4 print', width: 2480, height: 3508, unit: 'px', dpi: 300 },
  { id: 'wallpaper', name: 'Wallpaper 4K', width: 3840, height: 2160, unit: 'px' },
];

// Quick actions are handed to PhotoCrop together with the chosen file.
const QUICK_ACTIONS = [
  { id: 'remove-bg', name: 'Remove background', icon: 'eraser', description: 'Cut out the subject and make the background transparent.' },
  { id: 'resize', name: 'Resize image', icon: 'resize', description: 'Change the pixel size for web, print or social.' },
  { id: 'crop', name: 'Crop image', icon: 'crop', description: 'Trim edges or crop to a fixed aspect ratio.' },
  { id: 'convert', name: 'Convert format', icon: 'convert', description: 'Save as PNG, JPG or WebP.' },
  { id: 'compress', name: 'Compress image', icon: 'compress', description: 'Make the file smaller with minimal quality loss.' },
  { id: 'enhance', name: 'Auto enhance', icon: 'sparkles', description: 'One-click fix for exposure, contrast and color.' },
];

const TUTORIALS = [
  {
    id: 'tour', topic: 'Crop Cloud', title: 'Find your way around Crop Cloud', minutes: 2, level: 'Beginner',
    colors: ['#7b5cff', '#00c2ff'], icon: 'map',
    steps: [
      'Use the sidebar to switch between Home, Apps, Files, Quick actions and Learn.',
      'Press Ctrl+K (or /) anywhere to search apps, files, actions and settings.',
      'Drag images onto the window to add them to your recent files.',
      'Open Preferences with Ctrl+, to change theme, accent color and your display name.',
    ],
  },
  {
    id: 'shortcuts', topic: 'Crop Cloud', title: 'Work faster with keyboard shortcuts', minutes: 1, level: 'Beginner',
    colors: ['#2f6bff', '#36e0d0'], icon: 'keyboard',
    steps: [
      'Press ? to see every shortcut.',
      'Press 1–5 to jump between the sidebar pages.',
      'Press N to start a new file and O to open one.',
      'Press Esc to close any menu or dialog.',
    ],
  },
  {
    id: 'layers', topic: 'Photo basics', title: 'Layers: the idea behind every edit', minutes: 4, level: 'Beginner',
    colors: ['#ff7a00', '#ff2d6f'], icon: 'layers',
    steps: [
      'A layer is a sheet stacked on top of your photo. Edits on one layer leave the others untouched.',
      'Put each element (text, cut-out, adjustment) on its own layer so you can move or delete it later.',
      'Lower a layer’s opacity to blend it with what is underneath.',
      'Keep the original photo as the bottom layer and never paint directly on it.',
    ],
  },
  {
    id: 'crop-straighten', topic: 'Photo basics', title: 'Crop and straighten like a pro', minutes: 3, level: 'Beginner',
    colors: ['#00a86b', '#2f6bff'], icon: 'crop',
    steps: [
      'Decide where the photo will be used first, then pick that aspect ratio (1:1, 4:5, 16:9).',
      'Line up the horizon with the grid before cropping; a small tilt is very noticeable.',
      'Place the subject on a rule-of-thirds line instead of dead center.',
      'Crop non-destructively so you can widen the frame again later.',
    ],
  },
  {
    id: 'non-destructive', topic: 'Photo basics', title: 'Non-destructive editing', minutes: 5, level: 'Intermediate',
    colors: ['#4b2bff', '#ff4fd8'], icon: 'sparkles',
    steps: [
      'Use adjustment layers for brightness, contrast and color instead of changing pixels.',
      'Hide parts of a layer with a mask rather than erasing them.',
      'Duplicate a layer before any edit that cannot be undone.',
      'You can always go back, because the original pixels are never overwritten.',
    ],
  },
  {
    id: 'export', topic: 'Export', title: 'Export images for web and print', minutes: 3, level: 'Intermediate',
    colors: ['#009e9e', '#ffc23d'], icon: 'download',
    steps: [
      'Web: export JPG or WebP at 80% quality, around 2000px on the long edge.',
      'Transparent graphics: use PNG or WebP.',
      'Print: export at the final size at 300 DPI.',
      'Keep your layered working file separate from the files you export.',
    ],
  },
];

const SEED_NOTIFICATIONS = [
  { id: 'suite-0.2', icon: 'download', title: `${BRAND.name} 0.2.0`, body: 'A Windows app that updates itself, apps you download one by one, and one sign-in per computer.' },
  { id: 'welcome', icon: 'sparkles', title: `Welcome to ${BRAND.name}`, body: 'Your creative hub is set up. Start with a new file or drop in a photo.' },
  { id: 'framecrop-0.1', icon: 'play', title: 'FrameCrop 0.1.0 is ready', body: 'Edit video on a multi-track timeline, grade with color nodes and export MP4.' },
  { id: 'photocrop-0.2', icon: 'image', title: 'PhotoCrop 0.2.0 is ready', body: 'Layers, masks, selections, 20+ tools, adjustments and filters.' },
  { id: 'tip-search', icon: 'search', title: 'Tip: search everything', body: 'Press Ctrl+K to find apps, files and settings.' },
];

const SHORTCUTS = [
  ['Search', 'Ctrl K', '/'],
  ['New file', 'N'],
  ['Open file', 'O'],
  ['Preferences', 'Ctrl ,'],
  ['Keyboard shortcuts', '?'],
  ['Go to Home / Apps / Files / Quick actions / Learn', '1 – 5'],
  ['Close menu or dialog', 'Esc'],
];
