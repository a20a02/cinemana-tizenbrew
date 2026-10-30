# Cinemana for TizenBrew

A [TizenBrew](https://github.com/reisxd/TizenBrew) site-modification module that lets you use the **normal Cinemana website** (`cinemana.shabakaty.cc`) on a Samsung Tizen TV with the remote control.

## What it does

- Arrow keys move a visible focus ring between buttons, posters and menu items.
- Moving past the edge of a poster row slides the carousel.
- **OK** opens the focused item. Text fields open the TV keyboard.
- **Back** closes menus and dialogs, leaves fullscreen, or goes to the previous page. On the home page, press Back twice to exit.
- On the video player:
  - **OK** goes fullscreen and plays. In fullscreen, OK is play/pause.
  - **← / →** seek 10 seconds.
  - **Down** reaches the player's own buttons (subtitles, quality and so on), and **Up** leaves them.
- **Play/Pause, Stop, Fast-forward (+30 s) and Rewind (−10 s)** work everywhere.
- It skips the site's TV redirect and sign-in screen at startup. You can still sign in from the header button.
- The screensaver stays off while a video plays.

## Install

In TizenBrew, open **Module Manager → Add GitHub module** and enter:

```
a20a02/cinemana-tizenbrew
```

## License

MIT
