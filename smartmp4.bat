@echo off
setlocal enabledelayedexpansion
:: -r 30 -b:v 300k ^
:: 创建输出文件夹
if not exist "iPod_Output" mkdir "iPod_Output"

echo -------------------------------------------------------
echo   正在启动智能转换：自动识别横竖屏并压缩为 iPod 格式...
echo -------------------------------------------------------

:: 遍历当前目录下所有的 .mp4 文件
for %%i in (*.*) do (
    echo.
    echo 正在分析文件: "%%i"
    
    :: 使用 ffprobe 获取视频的宽度和高度
    for /f "tokens=1,2 delims=x" %%a in ('ffprobe -v error -select_streams v:0 -show_entries stream^=width^,height -of csv^=s^=x:p^=0 "%%i"') do (
        set width=%%a
        set height=%%b
    )
    
    :: 判断横竖屏并设置对应的滤镜
    if !height! GTR !width! (
        echo [竖屏检测] 高度 !height! 大于 宽度 !width!，将顺时针旋转 90 度并缩放。
        set "VF_FILTER=transpose=2,scale=432:240"
    ) else (
        echo [横屏检测] 宽度 !width! 大于等于 高度 !height!，将直接进行缩放。
        set "VF_FILTER=scale=432:240"
    )
    
    :: FFmpeg 核心转换命令，调用上面设置好的 VF_FILTER
    ffmpeg -i "%%i" ^
    -vf "!VF_FILTER!" ^
    -vcodec libx264 -profile:v baseline -level 3.0 ^
	-r 24 -b:v 200k ^
    -acodec aac -ac 2 -ar 32000 -b:a 48k ^
    -y "iPod_Output\%%~ni_nano.mp4"
)

echo.
echo -------------------------------------------------------
echo   全部视频已智能处理完毕！请查看 "iPod_Output" 文件夹。
echo -------------------------------------------------------
pause