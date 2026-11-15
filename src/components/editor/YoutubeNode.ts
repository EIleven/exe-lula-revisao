// src/components/editor/YoutubeNode.ts
import { Node, mergeAttributes } from '@tiptap/core';

export default Node.create({
  name: 'youtube',

  group: 'block',

  atom: true, // This makes it so you can't type inside it

  addAttributes() {
    return {
      videoId: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-youtube-video]',
        getAttrs: (dom: HTMLElement) => {
          const iframe = dom.querySelector('iframe');
          const src = iframe?.getAttribute('src');
          const videoId = src ? new URL(src).pathname.split('/').pop() : null;
          return { videoId };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const videoId = HTMLAttributes.videoId;
    if (!videoId) {
      return ['div'];
    }

    return [
      'div',
      { 'data-youtube-video': '' },
      [
        'div',
        { class: 'youtube-embed' },
        [
          'iframe',
          {
            src: `https://www.youtube.com/embed/${videoId}`,
            frameborder: 0,
            allowfullscreen: 'true',
            allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
          },
        ],
      ],
    ];
  },

  addNodeView() {
    return ({ editor, node }) => {
      const { videoId } = node.attrs;
      
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-youtube-video', '');
      
      const embedContainer = document.createElement('div');
      embedContainer.className = 'youtube-embed';
      
      const iframe = document.createElement('iframe');
      iframe.setAttribute('src', `https://www.youtube.com/embed/${videoId}`);
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('allowfullscreen', 'true');
      iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');

      embedContainer.appendChild(iframe);
      wrapper.appendChild(embedContainer);

      return {
        dom: wrapper,
      };
    };
  },
});
