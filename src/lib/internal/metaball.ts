/** A rounded box in pixels. */
export interface RoundedBox {
	left: number;
	top: number;
	width: number;
	height: number;
	radius: number;
}

/**
 * The bridge from a dot of radius `r` at `x`, `y` to the nearest edge of a
 * box, as between two metaballs about to part: wide where it meets each,
 * pinched between, and thinner the farther it stretches. Undefined when the
 * dot touches or is inside the box, or is beyond `reach` from it.
 */
export function neck(x: number, y: number, r: number, box: RoundedBox, reach: number): string | undefined {
	const corner = Math.min(box.radius, box.width / 2, box.height / 2);
	// The nearest point on a rounded box: clamp to the box shrunk by its corner, then step out by the corner.
	const cx = clamp(x, box.left + corner, box.left + box.width - corner);
	const cy = clamp(y, box.top + corner, box.top + box.height - corner);
	const away = Math.hypot(x - cx, y - cy);
	const gap = away - corner;
	if (gap <= r || gap > reach) return undefined;

	const ux = (cx - x) / away;
	const uy = (cy - y) / away;
	const nx = -uy;
	const ny = ux;
	// Sink the foot into the outline's stroke so the two read as one shape.
	const qx = cx - ux * (corner - 1);
	const qy = cy - uy * (corner - 1);
	const stretch = Math.min(1, (gap - r) / Math.max(reach - r, 1));

	const start = r * 0.85;
	const foot = r * (1.8 - 0.8 * stretch);
	const waist = Math.max(0.6, r * (0.55 - 0.35 * stretch));
	// A quadratic's middle sits at (start + foot) / 4 + control / 2; solve for the waist.
	const control = 2 * waist - (start + foot) / 2;
	const ax = x + ux * r * 0.3;
	const ay = y + uy * r * 0.3;
	const mx = (ax + qx) / 2;
	const my = (ay + qy) / 2;

	const point = (px: number, py: number, side: number, width: number) =>
		`${(px + nx * side * width).toFixed(2)} ${(py + ny * side * width).toFixed(2)}`;
	return [
		`M ${point(ax, ay, 1, start)}`,
		`Q ${point(mx, my, 1, control)} ${point(qx, qy, 1, foot)}`,
		`L ${point(qx, qy, -1, foot)}`,
		`Q ${point(mx, my, -1, control)} ${point(ax, ay, -1, start)}`,
		'Z'
	].join(' ');
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
