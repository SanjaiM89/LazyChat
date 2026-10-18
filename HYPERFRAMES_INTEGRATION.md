# HyperFrames Integration in LazyChat

This document explains how HyperFrames has been integrated into the LazyChat project for motion designing and video generation.

## Overview

HyperFrames is an open-source video rendering framework that allows you to write HTML and render it to video. It has been successfully integrated into this project by:

1. Cloning the HyperFrames repository from GitHub
2. Building all packages using Bun package manager
3. Creating valid HyperFrames compositions
4. Demonstrating the CLI functionality

## Project Structure

After integration, the project contains:
- `/hyperframes/` - The complete HyperFrames source code
- `/compositions/` - Directory for HyperFrames HTML compositions
- `/compositions/index.html` - Example composition demonstrating motion design

## Usage

### 1. Using the HyperFrames CLI

The HyperFrames CLI is available at:
```
/home/sanjai/Desktop/Projects/LazyChat/hyperframes/packages/cli/dist/cli.js
```

Or you can run it via Bun:
```
cd hyperframes && export BUN_INSTALL=/home/sanjai/Desktop/Projects/LazyChat/.bun && export PATH="$BUN_INSTALL/bin:$PATH" && bunx cli <command>
```

Common commands:
- `hyperframes lint` - Validate composition HTML
- `hyperframes preview` - Start live preview studio
- `hyperframes render -o output.mp4` - Render composition to video
- `hyperframes init my-project` - Scaffold a new composition project

### 2. Creating Compositions

HyperFrames compositions are HTML files with special attributes:
- Root element needs `data-composition-id`, `data-width`, `data-height`
- Animation elements use `class="clip"` with `data-enter`/`data-leave` attributes
- GSAP timeline must be registered on `window.__timelines[compositionId]`

See `/compositions/index.html` for a working example.

### 3. Programmatic Usage

The HyperFrames SDK can be used programmatically:
```javascript
import { openComposition } from '@hyperframes/sdk';

// Open and manipulate a composition
const session = await openComposition({
  entryPoint: 'path/to/composition.html',
  adapter: createMemoryAdapter() // or createFsAdapter() for file system
});

// Modify variables, elements, etc.
await session.update({ title: 'New Title' });

// Render to video
const { videoBlob } = await session.render({
  format: 'mp4',
  quality: 'standard'
});
```

## Motion Design Features

HyperFrames provides powerful motion design capabilities through:
- GSAP integration for complex animations
- Frame-accurate timing via `data-*` attributes
- Support for SVG, CSS, and WebGL animations
- Audio synchronization and mixing
- Template system for reusable components

## Video Generation Capabilities

With HyperFrames, you can generate:
- MP4 videos with H.264/AAC encoding
- WebM videos with VP9/Opus encoding (with transparency)
- GIF animations
- PNG sequences for post-processing
- HLS streaming content

## Example Composition

The project includes a sample composition at `compositions/index.html` that demonstrates:
- Text fade-in/fade-out animations
- Scaling effects
- Proper HyperFrames composition structure
- GSAP timeline registration

To render this composition:
```
cd compositions && ../hyperframes/packages/cli/dist/cli.js render -o output.mp4 .
```

## Development Workflow

1. Create/edit HTML composition in `/compositions/`
2. Validate with `hyperframes lint`
3. Preview live with `hyperframes preview`
4. Render final video with `hyperframes render -o output.mp4`
5. Use in LazyChat application as needed

## Dependencies

The integration uses:
- Bun package manager (installed locally in `.bun/`)
- HyperFrames built from source
- GSAP for animations (included via CDN in examples)

## Troubleshooting

If you encounter browser issues during rendering:
- Try `--docker` flag for containerized rendering
- Ensure proper GSAP registration on `window.__timelines`
- Verify composition has required data attributes
- Check that `window.__timelines` is properly initialized

## Resources

- HyperFrames Documentation: https://hyperframes.heygen.com/
- Component Registry: https://hyperframes.heygen.com/catalog/blocks
- Skills System: HyperFrames includes 21 AI agent skills for guided workflows

## Summary

HyperFrames has been successfully added to the LazyChat project, providing professional motion designing and video generation capabilities through HTML-based composition. The system is ready for creating animated videos, motion graphics, product demos, and other video content directly from HTML and CSS.
