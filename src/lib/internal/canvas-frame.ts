/** Let a canvas iframe receive hover while its host owns every other gesture. */
export function canvasFrame(node: HTMLIFrameElement) {
	let disconnect = () => {};

	function connect() {
		disconnect();
		delete node.dataset.pfHover;
		const view = node.contentWindow;
		// Frame routes are same-origin. Leave an inaccessible frame non-interactive.
		try {
			if (!view?.document.body) return;
		} catch {
			return;
		}

		const removers: (() => void)[] = [];
		function listen(type: string, listener: EventListener) {
			view!.addEventListener(type, listener, { capture: true, passive: false });
			removers.push(() => view!.removeEventListener(type, listener, { capture: true }));
		}
		function block(event: Event) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
		function point(event: MouseEvent) {
			const rect = node.getBoundingClientRect();
			// Frame events use local CSS pixels; canvas handlers use viewport pixels.
			return {
				bubbles: true, cancelable: true,
				clientX: rect.left + event.clientX * rect.width / node.clientWidth,
				clientY: rect.top + event.clientY * rect.height / node.clientHeight,
				button: event.button, buttons: event.buttons,
				altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey
			};
		}

		for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
			listen(type, (event) => {
				const pointer = event as PointerEvent;
				// Charts and tooltips still receive unpressed pointer movement.
				if (type !== 'pointermove' || pointer.buttons) block(event);
				node.dispatchEvent(new PointerEvent(type, {
					...point(pointer), pointerId: pointer.pointerId, pointerType: pointer.pointerType,
					isPrimary: pointer.isPrimary, pressure: pointer.pressure
				}));
			});
		}
		listen('dblclick', (event) => {
			block(event);
			node.dispatchEvent(new MouseEvent('dblclick', point(event as MouseEvent)));
		});
		listen('wheel', (event) => {
			block(event);
			const wheel = event as WheelEvent;
			node.dispatchEvent(new WheelEvent('wheel', {
				...point(wheel), deltaX: wheel.deltaX, deltaY: wheel.deltaY,
				deltaZ: wheel.deltaZ, deltaMode: wheel.deltaMode
			}));
		});
		for (const type of ['keydown', 'keyup']) {
			listen(type, (event) => {
				block(event);
				const key = event as KeyboardEvent;
				node.dispatchEvent(new KeyboardEvent(type, {
					bubbles: true, cancelable: true, key: key.key, code: key.code, repeat: key.repeat,
					altKey: key.altKey, ctrlKey: key.ctrlKey, metaKey: key.metaKey, shiftKey: key.shiftKey
				}));
			});
		}
		for (const type of [
			'mousedown', 'mouseup', 'click', 'auxclick', 'contextmenu', 'dragstart',
			'touchstart', 'touchmove', 'touchend', 'beforeinput', 'submit'
		]) listen(type, block);

		// Enable hit testing only after the capture guards are in place.
		node.dataset.pfHover = 'true';
		disconnect = () => {
			for (const remove of removers) remove();
			delete node.dataset.pfHover;
		};
	}

	node.addEventListener('load', connect);
	return () => {
		node.removeEventListener('load', connect);
		disconnect();
	};
}
