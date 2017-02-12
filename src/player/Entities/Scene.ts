const Marzipano = require('marzipano');

import Player, { ILifeCycle } from '../Player';
import CSS from '../Utils/CSS';
import PanoramaMode from '../PanoramaMode';
import StereoscopicMode from '../StereoscopicMode';
import Vector4 from '../Math/Vector4';
import Level from './Level';
import LinkHotspot, { ILinkHotspotData } from './Hotspot/LinkHotspot';
import InfoHotspot, { IInfoHotspotData } from './Hotspot/InfoHotspot';
import PairSet from "../Utils/PairSet";
import FS from "../Utils/FS";

/** Interface describing the required data to create a new [[Scene]]. */
export interface ISceneData {
  id: string;
  name: string;
  levels: Level[];
  faceSize: number;
  initialViewParameters: Vector4;
  linkHotspots: ILinkHotspotData[];
  infoHotspots: IInfoHotspotData[];
}

/** Class used to create a cubic image layer in the viewer. */
export default class Scene implements ILifeCycle {

  static PANORAMA_LIMITER = Marzipano.RectilinearView.limit.traditional(
    4096, 120 * Math.PI / 180);

  static STEREOSCOPIC_LIMITER = Marzipano.RectilinearView.limit.traditional(
    4096, 90 * Math.PI / 180);

  /** DEPRECATED // Avoid until fixed
  static PANORAMA_LIMITER = Marzipano.util.compose(
    Marzipano.RectilinearView.limit.vfov(110 * Math.PI / 180, 110 * Math.PI / 180),
    Marzipano.RectilinearView.limit.hfov(110 * Math.PI / 180, 110 * Math.PI / 180),
    Marzipano.RectilinearView.limit.pitch(-Math.PI / 2, Math.PI / 2));
  */

  /** DEPRECATED // Avoid until fixed
  static STEREOSCOPIC_LIMITER = Marzipano.util.compose(
    Marzipano.RectilinearView.limit.vfov(90 * Math.PI / 180, 90 * Math.PI / 180),
    Marzipano.RectilinearView.limit.hfov(90 * Math.PI / 180, 90 * Math.PI / 180),
    Marzipano.RectilinearView.limit.pitch(-Math.PI / 2, Math.PI / 2)); 
  */

  private _id: string;
  private _name: string;
  private _levels: Level[];
  private _faceSize: number;
  private _initialViewParameters: Vector4;
  private _linkHotspots: LinkHotspot[];
  private _infoHotspots: InfoHotspot[];

  private _player: Player;
  private _geometry: any;
  private _projectionCenter: Vector4;
  private _views: PairSet<any>;
  private _hotspotContainer: any;
  private _sources: PairSet<any>;
  private _textureStores: PairSet<any>;
  private _layers: PairSet<any>;

  private _cancelTweening: () => void;

  /** Contructor initializing stores, however does not create anything until the [[onCreate]] method is called.
   * @param _player The base player context.
   */
  constructor(
    _player: Player,
  ) {
    this._player = _player || this._player;
    this._sources = new PairSet();
    this._textureStores = new PairSet();
    this._layers = new PairSet();
  }

  /** Called after the constructor to create variables that later need to be disposed.
   * Using data specified in [[ISceneData]] to create the scene's layers for both eyes and hotspots.
   */
  onCreate(): boolean {
    this._geometry = new Marzipano.CubeGeometry(this._levels);
    this._projectionCenter = new Vector4(0, 0);
    this._views = new PairSet(
      new Marzipano.RectilinearView(this._initialViewParameters, Scene.PANORAMA_LIMITER),
      new Marzipano.RectilinearView(this._initialViewParameters, Scene.STEREOSCOPIC_LIMITER)
    );

    this.createLayer(this._player.viewer.stage(), this._views.primary, 'left', { relativeWidth: 0.5, relativeX: 0 });
    this.createLayer(this._player.viewer.stage(), this._views.secondary, 'right', { relativeWidth: 0.5, relativeX: 0.5 });

    this._hotspotContainer = new Marzipano.HotspotContainer(
      this._player.viewer._controlContainer,
      this._player.viewer.stage(),
      this._views.primary,
      this._player.viewer.renderLoop(),
      { rect: this._layers.primary.effects().rect }
    );

    this._linkHotspots.forEach((hotspot: LinkHotspot) => {
      this._hotspotContainer.createHotspot(hotspot.node, hotspot.position);
    })
    this._infoHotspots.forEach((hotspot: InfoHotspot) => {
      this._hotspotContainer.createHotspot(hotspot.node, hotspot.position);
    })
    return true;
  }

  /** Called by [[SceneManager.switchScene]] to change the currently displayed scene to this with and optional transition. */
  onAttach(transition?: (val: number, scene: Scene) => void, duration?: number, done?: () => void) {
    const stage = this._player.viewer.stage();

    // Change layer size depending on mode
    if (this._player.mode instanceof PanoramaMode) {
      this._views.primary.setLimiter(Scene.PANORAMA_LIMITER);
      this._views.primary.setProjectionCenterX(0);
      this._views.secondary.setProjectionCenterX(0);
      this._layers.primary.setEffects({ rect: { relativeWidth: 1 } });
      this.eye = 'left';
    } else {
      this._views.primary.setLimiter(Scene.STEREOSCOPIC_LIMITER);
      this._views.primary.setProjectionCenterX(this.projectionCenter.x);
      this._layers.primary.setEffects({ rect: { relativeWidth: 0.5 } });
      this.eye = (<StereoscopicMode>this._player.mode).dominantEye;
      stage.addLayer(this._layers.secondary);
    }
    stage.addLayer(this._layers.primary);

    // Make sure view parameters are equal after attach
    setTimeout(() => {
      this._views.primary.setParameters(this._initialViewParameters);
      this._views.secondary.setParameters(this._initialViewParameters);
    }, 0);

    // If no transition specified just return callback
    if (!transition) {
      this._hotspotContainer.show();
      if (typeof done === 'function') done();
      return;
    }

    // Cancel any ongoing transition
    if (this._cancelTweening) {
      this._cancelTweening();
      this._cancelTweening = null;
    }

    // Start a new tweening
    this._cancelTweening = Marzipano.util.tween(duration, (val) => {
      transition(val, this);
    }, () => {
      this._cancelTweening = null;
      this._hotspotContainer.show();
      if (typeof done === 'function') done();
    });
  }

  /** Called when window is focused after blur. */
  onResume() {
  }

  /** Called when window viewport size changes. */
  onResize() {
  }

  /** Called by [[SceneManager.switchScene]] to remove this scene with and optional transition. */
  onDetatch(transition?: (val: number, scene: Scene) => void, duration?: number, done?: () => void) {
    const stage = this._player.viewer.stage();

    // If no transition specified just return callback
    if (!transition) {
      this._hotspotContainer.hide();
      stage.removeLayer(this._layers.primary);
      if (stage.hasLayer(this._layers.secondary))
        stage.removeLayer(this._layers.secondary);

      if (typeof done === 'function') done();
      return;
    }

    // Cancel any ongoing transition
    if (this._cancelTweening) {
      this._cancelTweening();
      this._cancelTweening = null;
    }

    // Start a new tweening
    this._cancelTweening = Marzipano.util.tween(duration, (val) => {
      transition(val, this);
    }, () => {
      this._cancelTweening = null;
      this._hotspotContainer.hide();
      stage.removeLayer(this._layers.primary);
      if (stage.hasLayer(this._layers.secondary))
        stage.removeLayer(this._layers.secondary);

      if (typeof done === 'function') done();
    });
  }

  /** Called when window is blurred after focus. */
  onPause() {
  }

  /** Should be called at the end of a class' life cycle and should dispose all assigned variables. */
  onDestroy() {
    this._textureStores.pair(store => store.destroy());
    this._views.pair(view => view.destroy());
    this._layers.pair(layer => layer.destroy());
    this._hotspotContainer.destroy();

    this._geometry = null;
    this._views = null;
    this._sources = null;
    this._textureStores = null;
    this._layers = null;
    this._hotspotContainer = null;
  }

  //------------------------------------------------------------------------------------
  // METHODS
  //------------------------------------------------------------------------------------

  /** Internal helper method for creating scene layers for each eye. */
  private createLayer(stage: any, view: any, eye: 'left' | 'right', rect: any) {
    let path = FS.path(this._player.stagePath);
    path = path ? 'assets/tiles' : path + 'tiles';
    const source = new Marzipano.ImageUrlSource.fromString(
      `${path}/${this.id}/${eye}/{z}/{f}/{y}/{x}.jpg`,
      { cubeMapPreviewUrl: `${path}/${this.id}/${eye}/preview.jpg` }
    );
    /*
    const source = new Marzipano.ImageUrlSource.fromString(
      '//www.marzipano.net/media/music-room' + "/" + eye + "/{z}/{f}/{y}/{x}.jpg",
      { cubeMapPreviewUrl: '//www.marzipano.net/media/music-room' + "/" + eye + "/preview.jpg" });*/
    const store = new Marzipano.TextureStore(this._geometry, source, stage);
    const layer = new Marzipano.Layer(stage, source, this._geometry, view, store,
      { effects: { rect: rect } }
    );
    layer.pinFirstLevel();

    if (eye === 'left') {
      this._sources.primary = source;
      this._textureStores.primary = store;
      this._layers.primary = layer;
    } else {
      this._sources.secondary = source;
      this._textureStores.secondary = store;
      this._layers.secondary = layer;
    }
  }

  //------------------------------------------------------------------------------------
  // GETTERS & SETTERS
  //------------------------------------------------------------------------------------

  /** Sets this scene's projection center. */
  public set projectionCenter(center: Vector4) {
    this._views.primary.setProjectionCenterX(center.x);
    this._views.secondary.setProjectionCenterX(-center.x);
  }

  /** Sets the dominant eye moving hotspots to defined side. */
  public set eye(eye: 'left' | 'right') {
    if (eye === 'left') {
      this._hotspotContainer.setRect(this._layers.primary.effects().rect);
    } else {
      this._hotspotContainer.setRect(this._layers.secondary.effects().rect);
    }
    this._hotspotContainer._update();
  }

  /** Retrieves this scene's id. */
  public get id(): string {
    return this._id;
  }

  /** Retrieves this scene's name. */
  public get name(): string {
    return this._name;
  }

  /** Retrieves this scene's link hotspots. */
  public get linkHotspots(): LinkHotspot[] {
    return this._linkHotspots;
  }

  /** Retrieves this scene's info hotspots. */
  public get infoHotspots(): InfoHotspot[] {
    return this._infoHotspots;
  }

  /** Retrieves this scene's projection center. */
  public get projectionCenter(): Vector4 {
    return this._projectionCenter;
  }

  /** Retrieves this scene's view. See marzipano view documentaion. */
  public get views(): PairSet<any> {
    return this._views;
  }

  /** Retrieves this scene's layers. See marzipano layer documentaion. */
  public get layers(): PairSet<any> {
    return this._layers;
  }

  //------------------------------------------------------------------------------------
  // SERIALIZE
  //------------------------------------------------------------------------------------

  /** Deserializes JSON data to create a new [[Scene]].
   * @param player The base player context.
   * @param json The JSON data required to create a new [[Scene]].
   * @return A new Scene from the deserialized JSON data.
   */
  static fromJSON(player: Player, json: ISceneData | string): Scene {
    if (typeof json === 'string') {
      return JSON.parse(json, (key: string, value: any) => {
        return !key ? Scene.fromJSON(player, value) : value;
      });
    } else {
      const scene = Object.assign(Object.create(Scene.prototype), {
        _player: player,
        _id: json.id,
        _name: json.name,
        _levels: json.levels.map(level => Level.fromJSON(level)),
        _faceSize: json.faceSize,
        _initialViewParameters: new Vector4(json.initialViewParameters.yaw, json.initialViewParameters.pitch, 0, 90),
        _linkHotspots: json.linkHotspots.map(hotspot => LinkHotspot.fromJSON(player, hotspot)),
        _infoHotspots: json.infoHotspots.map(hotspot => InfoHotspot.fromJSON(player, hotspot)),
      });
      Scene.apply(scene);
      return scene;
    }
  }
}