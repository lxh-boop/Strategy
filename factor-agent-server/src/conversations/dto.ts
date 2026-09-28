import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'text 不能为空' })
  @MaxLength(2000, { message: '消息过长（最多 2000 字）' })
  text: string;
}
