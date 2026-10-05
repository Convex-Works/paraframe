// A small prototype that exercises paraframe without any product code.
import { resolve } from '$app/paths';
import { definePrototype } from '#lib';

const phone = { width: 390, height: 844 };

export const prototype = definePrototype({
	title: 'paraframe demo',
	description: 'A three-screen mail app, on desktop and phone',
	size: { width: 1280, height: 800 },
	sections: [
		{
			id: 'desktop',
			title: 'Desktop',
			frames: [
				{ id: 'inbox', title: 'Inbox', load: () => import('./frames/Inbox.svelte') },
				{ id: 'message', title: 'Message', load: () => import('./frames/Message.svelte') },
				{ id: 'reply', title: 'Reply', load: () => import('./frames/Reply.svelte') }
			]
		},
		{
			id: 'phone',
			title: 'Phone',
			frames: [
				{
					id: 'phone-inbox',
					title: 'Inbox',
					size: phone,
					props: { compact: true },
					load: () => import('./frames/Inbox.svelte')
				},
				{
					id: 'phone-message',
					title: 'Message',
					size: phone,
					props: { compact: true },
					load: () => import('./frames/Message.svelte')
				}
			]
		}
	],
	flows: [
		{ id: 'reply', title: 'Reply to a message', start: 'inbox' },
		{ id: 'phone', title: 'Read on a phone', start: 'phone-inbox' }
	],
	paths: {
		canvas: () => resolve(''),
		play: (frame) => resolve(`play/${frame}`),
		frame: (frame) => resolve(`frame/${frame}`)
	}
});
