// Column-major homogeneous transform, shared by camera projection and drag depth.
export function transform(point, matrix) {
  const [x, y, z] = point, m = matrix;
  const w = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15]);
  return [(m[0] * x + m[4] * y + m[8] * z + m[12]) * w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) * w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) * w];
}
