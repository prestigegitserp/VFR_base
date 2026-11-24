import { execFileSync } from 'node:child_process';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Pass a stock turn video and the destination Y4M file.');

// Three holds in the same recording give a software-rendered browser enough frames for inference.
function clip(source, output, start, end, stretch, hold=0) {
  const trim=`[${source}]trim=start_frame=${start}:end_frame=${end}`;
  const time=hold?`loop=loop=${hold*8-1}:size=1:start=0,setpts=N/(8*TB)`:`setpts=${stretch}*(PTS-STARTPTS)`;
  return `${trim},${time},fps=8[${output}]`;
}
const stages = [
  '[0:v]scale=360:640,setsar=1,split=5[a][b][c][d][e]',
  clip('a','front',79,80,1,17),
  clip('b','profileIn',80,86,13),
  clip('c','profile',86,87,1,9),
  clip('d','rearIn',87,92,13),
  clip('e','rear',92,93,1,14),
  '[front][profileIn][profile][rearIn][rear]concat=n=5:v=1:a=0[out]',
];
execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y','-i',source,
  '-filter_complex',stages.join(';'),'-map','[out]','-pix_fmt','yuv420p','-f','yuv4mpegpipe',destination],
  {stdio:'inherit'});
