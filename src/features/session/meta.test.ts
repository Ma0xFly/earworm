import { afterEach, describe, expect, it } from 'vitest';
import { readVideoMeta } from './meta';

afterEach(() => {
  document.body.innerHTML = '';
  document.title = '';
});

describe('readVideoMeta', () => {
  it('reads the title and channel from the current watch-page layout', () => {
    document.body.innerHTML = `
      <h1 class="ytd-watch-metadata"><yt-formatted-string>  Learn   English  </yt-formatted-string></h1>
      <div id="owner"><div id="channel-name"><a>Teacher   Mike</a></div></div>
    `;

    expect(readVideoMeta('vid1')).toEqual({
      videoId: 'vid1',
      title: 'Learn English',
      channel: 'Teacher Mike',
    });
  });

  it('accepts the legacy owner/channel selectors', () => {
    document.body.innerHTML = `
      <div id="title"><h1><yt-formatted-string>Legacy video</yt-formatted-string></h1></div>
      <ytd-video-owner-renderer>
        <ytd-channel-name><a href="/@legacy">Legacy Channel</a></ytd-channel-name>
      </ytd-video-owner-renderer>
    `;

    expect(readVideoMeta('vid2')).toMatchObject({
      title: 'Legacy video',
      channel: 'Legacy Channel',
    });
  });

  it('falls back to document title and the author metadata', () => {
    document.title = 'Fallback title - YouTube';
    const author = document.createElement('meta');
    author.setAttribute('name', 'author');
    author.setAttribute('content', 'Meta Channel');
    document.head.appendChild(author);

    expect(readVideoMeta('vid3')).toEqual({
      videoId: 'vid3',
      title: 'Fallback title',
      channel: 'Meta Channel',
    });
  });

  it('never throws on an empty page and reports empty strings', () => {
    expect(readVideoMeta('vid4')).toEqual({
      videoId: 'vid4',
      title: '',
      channel: '',
    });
  });
});
